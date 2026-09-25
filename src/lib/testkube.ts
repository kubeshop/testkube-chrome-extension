import type {
  Environment,
  ExecutionIntegrationEvent,
  GithubAppCapability,
  GithubRepository,
  GithubRepositoryIntegration,
  GithubRepositoryIntegrationEventList,
  GithubRepositoryList,
  ListExecutionIntegrationEventsResponse,
  ListResponse,
  Organization,
  Settings,
  TestWorkflowExecutionsResult,
} from './types';

export class TestkubeError extends Error {
  status?: number;
  // The `detail` member of an RFC 7807 problem body, when the API sent one.
  detail?: string;
  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'TestkubeError';
    this.status = status;
    this.detail = detail;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function controlPlaneBase(s: Settings): string {
  return s.apiBaseUrl.replace(/\/+$/, '');
}

function envPath(orgId: string, environmentId: string, suffix: string): string {
  return `/organizations/${encodeURIComponent(orgId)}/environments/${encodeURIComponent(environmentId)}${suffix}`;
}

function agentPath(orgId: string, environmentId: string, suffix: string): string {
  return envPath(orgId, environmentId, `/agent${suffix}`);
}

// Pull the human-readable detail out of a problem+json body, if it is one.
function problemDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {detail?: unknown; title?: unknown};
    if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail;
    if (typeof parsed.title === 'string' && parsed.title) return parsed.title;
  } catch {
    // not JSON
  }
  return undefined;
}

// GET a path relative to the control-plane base URL.
async function apiGet<T>(s: Settings, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${controlPlaneBase(s)}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${s.apiToken}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new TestkubeError(`Network error contacting Testkube: ${String(err)}`);
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore body read errors
    }
    const detail = problemDetail(body);
    throw new TestkubeError(
      `Testkube API ${res.status} ${res.statusText}${body ? `: ${truncate(detail ?? body, 200)}` : ''}`,
      res.status,
      detail
    );
  }
  return (await res.json()) as T;
}

// List the organizations the token can see. A token is tied to a single org, so
// this normally returns exactly one element.
export async function listOrganizations(s: Settings): Promise<Organization[]> {
  const data = await apiGet<ListResponse<Organization>>(s, '/organizations');
  return data.elements ?? [];
}

// List the environments the token may access within an organization.
export async function listEnvironments(s: Settings, orgId: string): Promise<Environment[]> {
  const data = await apiGet<ListResponse<Environment>>(s, `/organizations/${encodeURIComponent(orgId)}/environments`);
  return data.elements ?? [];
}

// List all TestWorkflows for a specific organization/environment.
export async function listWorkflows(s: Settings, orgId: string, environmentId: string): Promise<unknown[]> {
  const data = await apiGet<unknown>(s, agentPath(orgId, environmentId, '/test-workflows'));
  return Array.isArray(data) ? data : [];
}

// Latest execution (status + id) for a workflow (best effort). The id lets us
// deep-link straight to the most recent execution's details page.
export async function getLatestExecution(
  s: Settings,
  orgId: string,
  environmentId: string,
  workflowName: string
): Promise<{status?: string; id?: string}> {
  const data = await apiGet<TestWorkflowExecutionsResult>(
    s,
    agentPath(orgId, environmentId, `/test-workflows/${encodeURIComponent(workflowName)}/executions`)
  );
  const latest = data.results?.[0];
  return {status: latest?.result?.status, id: latest?.id};
}

// ---- GitHub App (Git Integration) --------------------------------------------

// Detail text the control plane returns on the 403 when the GitHub App
// feature is off (matched verbatim).
const FEATURE_DISABLED_DETAIL = 'quality loop feature is not enabled';

// Repositories connected to an environment through the GitHub App.
export async function listGithubIntegrations(
  s: Settings,
  orgId: string,
  environmentId: string
): Promise<GithubRepositoryIntegration[]> {
  const data = await apiGet<GithubRepositoryIntegration[] | null>(
    s,
    envPath(orgId, environmentId, '/integrations/github/integrations')
  );
  return Array.isArray(data) ? data : [];
}

// Classify what the token can do with the GitHub App endpoints in an
// environment. Uses the integrations list as the probe because it is the
// cheapest call gated by the same role check as the rest of the feature.
//
// The feature gate runs before the role check server-side, so a 403 carrying
// the "not enabled" detail means the whole control plane has it off; a bare
// 403 means this token is denied in this environment (the environment read
// role suffices on current control planes; older ones required run).
export async function probeGithubApp(
  s: Settings,
  orgId: string,
  environmentId: string
): Promise<{capability: GithubAppCapability; integrations: GithubRepositoryIntegration[]; error?: string}> {
  try {
    const integrations = await listGithubIntegrations(s, orgId, environmentId);
    return {capability: 'available', integrations};
  } catch (err) {
    if (err instanceof TestkubeError && err.status === 403) {
      const detail = (err.detail ?? '').toLowerCase();
      if (detail.includes(FEATURE_DISABLED_DETAIL)) {
        return {capability: 'disabled', integrations: [], error: err.message};
      }
      return {capability: 'forbidden', integrations: [], error: err.message};
    }
    // Older control planes without the feature answer 404 for the route.
    if (err instanceof TestkubeError && err.status === 404) {
      return {capability: 'disabled', integrations: [], error: err.message};
    }
    return {
      capability: 'error',
      integrations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Resolve `owner/repo` to the GitHub repository reachable through the org's
// installations. Returns undefined when no installation covers the repo.
export async function findGithubRepository(
  s: Settings,
  orgId: string,
  environmentId: string,
  fullName: string
): Promise<GithubRepository | undefined> {
  const q = encodeURIComponent(fullName);
  const data = await apiGet<GithubRepositoryList>(
    s,
    envPath(orgId, environmentId, `/integrations/github/repositories?q=${q}&perPage=50`)
  );
  const wanted = fullName.toLowerCase();
  return (data.repositories ?? []).find(r => (r.fullName ?? '').toLowerCase() === wanted);
}

// Processed webhook events for a connected repository, newest first.
export async function listGithubIntegrationEvents(
  s: Settings,
  orgId: string,
  environmentId: string,
  repositoryId: string,
  page = 1,
  perPage = 50
): Promise<GithubRepositoryIntegrationEventList> {
  const data = await apiGet<GithubRepositoryIntegrationEventList>(
    s,
    envPath(
      orgId,
      environmentId,
      `/integrations/github/repositories/${encodeURIComponent(repositoryId)}/events?page=${page}&perPage=${perPage}`
    )
  );
  return data ?? {};
}

// The GitHub event(s) that started an execution, with PR context (head SHA).
export async function listExecutionIntegrationEvents(
  s: Settings,
  orgId: string,
  environmentId: string,
  executionId: string
): Promise<ExecutionIntegrationEvent[]> {
  const data = await apiGet<ListExecutionIntegrationEventsResponse>(
    s,
    envPath(orgId, environmentId, `/executions/${encodeURIComponent(executionId)}/integration-events`)
  );
  return data.events ?? [];
}
