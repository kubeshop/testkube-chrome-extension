import type {
  Environment,
  ListResponse,
  Organization,
  Settings,
  TestWorkflowExecutionsResult,
} from './types';

export class TestkubeError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TestkubeError';
    this.status = status;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function controlPlaneBase(s: Settings): string {
  return s.apiBaseUrl.replace(/\/+$/, '');
}

function agentPath(orgId: string, environmentId: string, suffix: string): string {
  return `/organizations/${encodeURIComponent(orgId)}/environments/${encodeURIComponent(
    environmentId,
  )}/agent${suffix}`;
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
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore body read errors
    }
    throw new TestkubeError(
      `Testkube API ${res.status} ${res.statusText}${detail ? `: ${truncate(detail, 200)}` : ''}`,
      res.status,
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
  const data = await apiGet<ListResponse<Environment>>(
    s,
    `/organizations/${encodeURIComponent(orgId)}/environments`,
  );
  return data.elements ?? [];
}

// List all TestWorkflows for a specific organization/environment.
export async function listWorkflows(
  s: Settings,
  orgId: string,
  environmentId: string,
): Promise<unknown[]> {
  const data = await apiGet<unknown>(s, agentPath(orgId, environmentId, '/test-workflows'));
  return Array.isArray(data) ? data : [];
}

// Latest execution (status + id) for a workflow (best effort). The id lets us
// deep-link straight to the most recent execution's details page.
export async function getLatestExecution(
  s: Settings,
  orgId: string,
  environmentId: string,
  workflowName: string,
): Promise<{ status?: string; id?: string }> {
  const data = await apiGet<TestWorkflowExecutionsResult>(
    s,
    agentPath(orgId, environmentId, `/test-workflows/${encodeURIComponent(workflowName)}/executions`),
  );
  const latest = data.results?.[0];
  return { status: latest?.result?.status, id: latest?.id };
}
