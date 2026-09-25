import { getSettings, isConfigured } from '../lib/storage';
import { hasHostPermission, hostPatternFor } from '../lib/permissions';
import {
  findGithubRepository,
  getLatestExecution,
  listEnvironments,
  listExecutionIntegrationEvents,
  listGithubIntegrationEvents,
  listOrganizations,
  listWorkflows,
  probeGithubApp,
  TestkubeError,
} from '../lib/testkube';
import {
  extractGitUris,
  nearestNonGlobDir,
  workflowMatchesRepo,
  type MatchedGitPath,
  type RepoRef,
} from '../lib/match';
import { log, warn, error as logError } from '../lib/log';
import type {
  EnvironmentCapability,
  MatchedEnvironment,
  MatchedWorkflow,
  MatchesResponse,
  PullRequestChild,
  PullRequestResponse,
  PullRequestRun,
  RecentPullRequest,
  RepoGithubConnection,
  RepoGithubInfo,
  RuntimeRequest,
} from '../lib/messaging';
import type {
  Environment,
  GithubAppCapability,
  GithubRepositoryIntegration,
  GithubRepositoryIntegrationEvent,
  Settings,
  TestWorkflowStatus,
} from '../lib/types';

log('service worker loaded');

const CACHE_TTL_MS = 3 * 60 * 1000;
const STATUS_CONCURRENCY = 8;
const ENV_CONCURRENCY = 4;
const DISCOVERY_CACHE_KEY = 'discoveryCache';
const WORKFLOWS_CACHE_KEY = 'workflowsCache';
const GITHUB_CACHE_KEY = 'githubAppCache';

// Label the control plane stamps on workflows a system component owns (the
// GitHub App's synthesized parent workflows, test catalog scaffolds, ...). The
// dashboard hides these by default; the agent proxy does not, so we do. The
// GitHub App's parent workflows are also recognized by name in case the
// label is missing from the proxied object.
const MANAGED_BY_LABEL = 'testkube.io/managed-by';
const GITHUB_APP_PARENT_PREFIX = 'ql-parent-';

// How many recent PR runs the repo sidebar lists, and how many event pages the
// PR panel is willing to page through looking for a specific PR.
const RECENT_PR_LIMIT = 5;
const EVENTS_PAGE_SIZE = 50;
const MAX_EVENT_PAGES = 3;

// A custom control plane the user has not granted host access to yet: fail
// with a message that points at the fix instead of a bare "Failed to fetch".
async function hostAccessError(s: Settings): Promise<string | undefined> {
  if (await hasHostPermission(s.apiBaseUrl)) return undefined;
  const pattern = hostPatternFor(s.apiBaseUrl);
  return pattern
    ? `Access to ${pattern.replace(/\/\*$/, '')} has not been granted. Open the extension options and click "Grant access".`
    : `The API base URL "${s.apiBaseUrl}" is not a valid http(s) URL. Fix it in the extension options.`;
}

// Run an async function over items with a bounded number of in-flight calls.
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

// The cache signature ties cached data to the current base URL + token, so it is
// invalidated automatically when the user reconfigures the extension.
function cacheSignature(s: Settings): string {
  return `${s.apiBaseUrl}|${s.apiToken}`;
}

type EnvRef = { id: string; name: string };

interface DiscoveryCache {
  sig: string;
  fetchedAt: number;
  orgId: string;
  environments: EnvRef[];
}

interface WorkflowsCache {
  sig: string;
  entries: Record<string, { fetchedAt: number; workflows: unknown[] }>;
}

// Resolve the org id and the token-accessible environments, cached with a TTL.
async function discover(s: Settings, force: boolean): Promise<{ orgId: string; environments: EnvRef[] }> {
  const sig = cacheSignature(s);
  if (!force) {
    const stored = (await chrome.storage.local.get(DISCOVERY_CACHE_KEY))[DISCOVERY_CACHE_KEY] as
      | DiscoveryCache
      | undefined;
    if (stored && stored.sig === sig && Date.now() - stored.fetchedAt < CACHE_TTL_MS) {
      return { orgId: stored.orgId, environments: stored.environments };
    }
  }

  const orgs = await listOrganizations(s);
  if (orgs.length === 0) {
    throw new TestkubeError('No organizations are accessible with this token.');
  }
  const orgId = orgs[0].id;
  const envs = await listEnvironments(s, orgId);
  const environments = envs.map((e: Environment) => ({ id: e.id, name: e.name }));
  log(`discovered org ${orgId} with ${environments.length} environment(s)`);

  const entry: DiscoveryCache = { sig, fetchedAt: Date.now(), orgId, environments };
  await chrome.storage.local.set({ [DISCOVERY_CACHE_KEY]: entry });
  return { orgId, environments };
}

type WorkflowEntries = WorkflowsCache['entries'];

// Load the per-environment workflow cache (reset if the token/base URL changed).
async function loadWorkflowEntries(sig: string): Promise<WorkflowEntries> {
  const cache = (await chrome.storage.local.get(WORKFLOWS_CACHE_KEY))[WORKFLOWS_CACHE_KEY] as
    | WorkflowsCache
    | undefined;
  return cache && cache.sig === sig ? cache.entries : {};
}

function getWorkflowName(workflow: unknown): string | undefined {
  if (!workflow || typeof workflow !== 'object') return undefined;
  const obj = workflow as { name?: string; metadata?: { name?: string } };
  return obj.name ?? obj.metadata?.name;
}

function isSystemManaged(workflow: unknown): boolean {
  if (!workflow || typeof workflow !== 'object') return false;
  if ((getWorkflowName(workflow) ?? '').startsWith(GITHUB_APP_PARENT_PREFIX)) return true;
  const obj = workflow as {
    labels?: Record<string, string>;
    metadata?: { labels?: Record<string, string> };
  };
  const labels = obj.labels ?? obj.metadata?.labels;
  return Boolean(labels && typeof labels === 'object' && MANAGED_BY_LABEL in labels);
}

// ---- Dashboard URLs ---------------------------------------------------------

function dashboardBase(s: Settings): string {
  return s.dashboardBaseUrl.replace(/\/+$/, '');
}

function buildEnvironmentBase(s: Settings, orgId: string, envId: string): string {
  return `${dashboardBase(s)}/organization/${encodeURIComponent(orgId)}/environment/${encodeURIComponent(
    envId,
  )}/dashboard`;
}

function buildEnvironmentUrl(s: Settings, orgId: string, envId: string): string {
  return `${buildEnvironmentBase(s, orgId, envId)}/test-workflows`;
}

function buildExecutionsUrl(s: Settings, orgId: string, envId: string): string {
  return `${buildEnvironmentBase(s, orgId, envId)}/executions`;
}

function buildWorkflowExecutionsUrl(s: Settings, orgId: string, envId: string, name: string): string {
  // The workflow's Executions tab (fallback when there are no runs yet).
  return `${buildEnvironmentUrl(s, orgId, envId)}/${encodeURIComponent(name)}/executions`;
}

function buildExecutionDetailsUrl(s: Settings, orgId: string, envId: string, execId: string): string {
  // The details page for a specific execution.
  return `${buildEnvironmentBase(s, orgId, envId)}/executions/${encodeURIComponent(execId)}`;
}

// The AI analysis chat linked to a PR run.
function buildAiSessionUrl(s: Settings, orgId: string, envId: string, sessionId: string): string {
  return `${buildEnvironmentBase(s, orgId, envId)}/chats/${encodeURIComponent(sessionId)}`;
}

// The dashboard's connect-a-repository flow, preselecting this repo.
function buildConnectUrl(s: Settings, orgId: string, envId: string, repositoryId?: string): string {
  const params = new URLSearchParams({
    ref: 'github-app-installation',
    organization_id: orgId,
    environment_id: envId,
  });
  if (repositoryId) params.set('repository_id', repositoryId);
  return `${dashboardBase(s)}/onboarding?${params.toString()}`;
}

// Build a GitHub link for a workflow git path, pointing at the nearest non-glob
// directory (a glob like `tests/**/*.spec.ts` links to `tests/`). GitHub
// redirects `/tree/<ref>/<file>` to the blob view, so concrete file paths work too.
function buildRepoPathUrl(repo: RepoRef, path: MatchedGitPath): string {
  const ref = path.revision && path.revision.trim() ? path.revision.trim() : 'HEAD';
  const base = `https://${repo.host}/${repo.owner}/${repo.repo}`;
  const dir = nearestNonGlobDir(path.path);
  if (!dir) return `${base}/tree/${encodeURIComponent(ref)}`;
  const encodedDir = dir
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/tree/${encodeURIComponent(ref)}/${encodedDir}`;
}

// ---- GitHub App cache + scan -----------------------------------------------

interface GithubCache {
  sig: string;
  // Per environment: what the token can do + the connected repositories.
  envs: Record<
    string,
    { fetchedAt: number; capability: GithubAppCapability; integrations: GithubRepositoryIntegration[] }
  >;
  // `owner/repo` (lowercased) -> GitHub repository id, or '' when no
  // installation covers the repo.
  repos: Record<string, { fetchedAt: number; repositoryId: string }>;
}

async function loadGithubCache(sig: string): Promise<GithubCache> {
  const cache = (await chrome.storage.local.get(GITHUB_CACHE_KEY))[GITHUB_CACHE_KEY] as
    | GithubCache
    | undefined;
  return cache && cache.sig === sig ? cache : { sig, envs: {}, repos: {} };
}

interface GithubScan {
  capabilities: EnvironmentCapability[];
  featureDisabled: boolean;
  // Environments where the token can use the GitHub App endpoints.
  capable: Array<EnvRef & { integrations: GithubRepositoryIntegration[] }>;
}

// Probe every environment (cached) for GitHub App capability. Once one
// environment reports the feature as disabled, the rest are skipped since the
// flag is control-plane wide.
async function scanGithubApp(
  s: Settings,
  orgId: string,
  environments: EnvRef[],
  cache: GithubCache,
  force: boolean,
): Promise<GithubScan> {
  let featureDisabled = Object.values(cache.envs).some(
    (e) => e.capability === 'disabled' && Date.now() - e.fetchedAt < CACHE_TTL_MS,
  );

  await mapWithConcurrency(environments, ENV_CONCURRENCY, async (env) => {
    const hit = cache.envs[env.id];
    if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return;
    if (featureDisabled && !force) {
      cache.envs[env.id] = { fetchedAt: Date.now(), capability: 'disabled', integrations: [] };
      return;
    }
    const probe = await probeGithubApp(s, orgId, env.id);
    if (probe.capability === 'disabled') featureDisabled = true;
    if (probe.capability !== 'available') {
      log(`GitHub App in env "${env.name}": ${probe.capability}${probe.error ? ` (${probe.error})` : ''}`);
    }
    cache.envs[env.id] = {
      fetchedAt: Date.now(),
      capability: probe.capability,
      integrations: probe.integrations,
    };
  });

  const capabilities: EnvironmentCapability[] = environments.map((env) => ({
    environmentId: env.id,
    environmentName: env.name,
    capability: cache.envs[env.id]?.capability ?? 'error',
  }));
  const capable = environments
    .filter((env) => cache.envs[env.id]?.capability === 'available')
    .map((env) => ({ ...env, integrations: cache.envs[env.id].integrations }));

  return { capabilities, featureDisabled, capable };
}

// Resolve `owner/repo` to its GitHub repository id via any capable environment
// (the repositories endpoint is backed by the org's installations). Cached;
// a miss is cached too so unrelated repos do not re-query every visit.
async function resolveRepositoryId(
  s: Settings,
  orgId: string,
  capable: EnvRef[],
  fullName: string,
  cache: GithubCache,
  force: boolean,
): Promise<string | undefined> {
  if (capable.length === 0) return undefined;
  const key = fullName.toLowerCase();
  const hit = cache.repos[key];
  if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.repositoryId || undefined;
  }
  let repositoryId = '';
  try {
    const repo = await findGithubRepository(s, orgId, capable[0].id, fullName);
    if (repo) repositoryId = String(repo.id);
  } catch (err) {
    warn(`GitHub repository lookup failed for ${fullName}:`, err);
    return undefined;
  }
  cache.repos[key] = { fetchedAt: Date.now(), repositoryId };
  return repositoryId || undefined;
}

// Overall test status of a PR run, from its child executions when it has
// fanned out, else from the pipeline status of the event itself.
function deriveOverall(event: GithubRepositoryIntegrationEvent): TestWorkflowStatus {
  const children = event.children ?? [];
  if (children.length > 0) {
    const statuses = children.map((c) => (c.status ?? '').toLowerCase());
    if (statuses.some((st) => st === 'failed' || st === 'timeout')) return 'failed';
    if (statuses.some((st) => ['running', 'queued', 'assigned', 'paused', ''].includes(st))) return 'running';
    if (statuses.some((st) => st === 'aborted' || st === 'aborting')) return 'aborted';
    if (statuses.some((st) => st === 'canceled' || st === 'cancelled')) return 'canceled';
    if (statuses.every((st) => st === 'passed')) return 'passed';
    return statuses[0] || 'running';
  }
  switch (event.status) {
    case 'completed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'canceled';
    default:
      return 'running';
  }
}

function isPullRequestEvent(event: GithubRepositoryIntegrationEvent): boolean {
  return (event.kind === 'pull_request' || event.kind === 'issue_comment') && Boolean(event.issueNumber);
}

// Latest PR events for the repo sidebar: newest event per PR number.
function recentPullRequests(
  s: Settings,
  orgId: string,
  envId: string,
  repo: RepoRef,
  events: GithubRepositoryIntegrationEvent[],
): RecentPullRequest[] {
  const byNumber = new Map<number, GithubRepositoryIntegrationEvent>();
  const sorted = [...events].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  for (const e of sorted) {
    if (!isPullRequestEvent(e)) continue;
    const n = e.issueNumber as number;
    if (!byNumber.has(n)) byNumber.set(n, e);
    if (byNumber.size >= RECENT_PR_LIMIT) break;
  }
  return [...byNumber.entries()].map(([n, e]) => ({
    number: n,
    url: `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${n}`,
    eventStatus: e.status,
    overall: deriveOverall(e),
    aiSessionUrl: e.aiSessionId ? buildAiSessionUrl(s, orgId, envId, e.aiSessionId) : undefined,
    children: (e.children ?? []).map((c) => ({
      id: c.id,
      workflowName: c.workflowName,
      status: c.status,
      url: buildExecutionDetailsUrl(s, orgId, envId, c.id),
    })),
    updatedAt: e.updatedAt ?? e.createdAt,
  }));
}

// GitHub App state for the repo: capability per environment, connections and
// their recent PR runs, or a connect link when the repo is reachable but not
// connected anywhere.
async function buildRepoGithubInfo(
  s: Settings,
  orgId: string,
  environments: EnvRef[],
  repo: RepoRef,
  force: boolean,
): Promise<RepoGithubInfo> {
  const cache = await loadGithubCache(cacheSignature(s));
  const scan = await scanGithubApp(s, orgId, environments, cache, force);
  const fullName = `${repo.owner}/${repo.repo}`;
  const repositoryId = await resolveRepositoryId(s, orgId, scan.capable, fullName, cache, force);
  await chrome.storage.local.set({ [GITHUB_CACHE_KEY]: cache });

  const info: RepoGithubInfo = {
    capabilities: scan.capabilities,
    featureDisabled: scan.featureDisabled,
    connections: [],
  };
  // No installation covers this repo yet: offer the onboarding flow anyway
  // (it walks through installing the app), without a preselected repository.
  if (!repositoryId) {
    if (scan.capable.length > 0) {
      info.connectUrl = buildConnectUrl(s, orgId, scan.capable[0].id);
      info.connectEnvironmentName = scan.capable[0].name;
    }
    return info;
  }

  const connections: RepoGithubConnection[] = [];
  await mapWithConcurrency(scan.capable, ENV_CONCURRENCY, async (env) => {
    const integration = env.integrations.find((i) => i.repositoryId === repositoryId);
    if (!integration) return;
    let events: GithubRepositoryIntegrationEvent[] = [];
    try {
      const page = await listGithubIntegrationEvents(s, orgId, env.id, repositoryId, 1, 20);
      events = page.events ?? [];
    } catch (err) {
      warn(`events lookup failed for ${fullName} in env "${env.name}":`, err);
    }
    connections.push({
      environmentId: env.id,
      environmentName: env.name,
      repositoryId,
      status: integration.status,
      workflowName: integration.workflowName,
      errorMessage: integration.errorMessage,
      recentPullRequests: recentPullRequests(s, orgId, env.id, repo, events),
    });
  });
  info.connections = connections.sort((a, b) => a.environmentName.localeCompare(b.environmentName));

  if (connections.length === 0 && scan.capable.length > 0) {
    const target = scan.capable[0];
    info.connectUrl = buildConnectUrl(s, orgId, target.id, repositoryId);
    info.connectEnvironmentName = target.name;
  }
  return info;
}

// ---- GET_MATCHES ------------------------------------------------------------

async function handleGetMatches(owner: string, repo: string, force: boolean): Promise<MatchesResponse> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    log('not configured (missing apiBaseUrl/apiToken)');
    return { ok: true, configured: false, matches: [], environments: [] };
  }

  const hostError = await hostAccessError(settings);
  if (hostError) return { ok: false, configured: true, matches: [], environments: [], error: hostError };

  const repoRef: RepoRef = { host: 'github.com', owner, repo };
  try {
    const { orgId, environments } = await discover(settings, force);

    // The GitHub App scan is independent of the workflow scan; run them side by side.
    const githubPromise: Promise<RepoGithubInfo | undefined> = settings.githubAppIntegration
      ? buildRepoGithubInfo(settings, orgId, environments, repoRef, force).catch((err) => {
          warn('GitHub App scan failed:', err);
          return undefined;
        })
      : Promise.resolve(undefined);

    const matched: MatchedWorkflow[] = [];
    const allUris = new Set<string>();

    const sig = cacheSignature(settings);
    const entries = force ? {} : await loadWorkflowEntries(sig);

    // Scan each accessible environment for workflows testing this repo. The cache
    // is mutated in memory here and persisted once after the loop to avoid
    // concurrent read-modify-write races across env workers.
    await mapWithConcurrency(environments, ENV_CONCURRENCY, async (env) => {
      let workflows: unknown[];
      const hit = entries[env.id];
      if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
        workflows = hit.workflows;
      } else {
        try {
          workflows = await listWorkflows(settings, orgId, env.id);
        } catch (err) {
          // Skip environments the token cannot read (401/403) or that error out.
          warn(`skipping env "${env.name}" (${env.id}):`, err);
          return;
        }
        entries[env.id] = { fetchedAt: Date.now(), workflows };
      }
      log(`env "${env.name}": ${workflows.length} workflow(s)`);

      for (const wf of workflows) {
        // Hide system-owned workflows (e.g. the GitHub App's parent workflow),
        // matching what the dashboard shows by default.
        if (isSystemManaged(wf)) continue;
        const { matches, gitUris, paths } = workflowMatchesRepo(wf, repoRef);
        if (!matches) {
          if (matched.length === 0) for (const uri of extractGitUris(wf)) allUris.add(uri);
          continue;
        }
        const name = getWorkflowName(wf);
        if (!name) continue;
        const linkedPaths = paths.map((p) => ({
          label: p.path,
          url: buildRepoPathUrl(repoRef, p),
        }));
        matched.push({
          name,
          gitUris,
          environmentId: env.id,
          environmentName: env.name,
          // Default to the workflow's Executions tab; replaced with a direct
          // link to the latest execution once we know its id (below).
          dashboardUrl: buildWorkflowExecutionsUrl(settings, orgId, env.id, name),
          paths: linkedPaths.length ? linkedPaths : undefined,
        });
      }
    });

    await chrome.storage.local.set({ [WORKFLOWS_CACHE_KEY]: { sig, entries } });

    log(
      `matched ${matched.length} workflow(s) for github.com/${owner}/${repo}`,
      matched.map((m) => `${m.environmentName}/${m.name}`),
    );
    if (matched.length === 0 && allUris.size > 0) {
      log('no matches; git URIs discovered across workflows:', [...allUris]);
    }

    // Latest execution (status + id) for every matched workflow, with bounded
    // concurrency. When an execution exists, link straight to its details page.
    await mapWithConcurrency(matched, STATUS_CONCURRENCY, async (m) => {
      try {
        const latest = await getLatestExecution(settings, orgId, m.environmentId, m.name);
        m.status = latest.status;
        if (latest.id) {
          m.dashboardUrl = buildExecutionDetailsUrl(settings, orgId, m.environmentId, latest.id);
        }
      } catch (err) {
        log(`status lookup failed for "${m.name}":`, err);
      }
    });

    // Environments that actually have matches, for the dropdown.
    const envMatches = new Map<string, MatchedEnvironment>();
    for (const m of matched) {
      const existing = envMatches.get(m.environmentId);
      if (existing) {
        existing.matchCount += 1;
      } else {
        envMatches.set(m.environmentId, {
          id: m.environmentId,
          name: m.environmentName,
          matchCount: 1,
          dashboardUrl: buildEnvironmentUrl(settings, orgId, m.environmentId),
          executionsUrl: buildExecutionsUrl(settings, orgId, m.environmentId),
        });
      }
    }

    const github = await githubPromise;
    if (github) {
      log(
        `GitHub App: ${github.connections.length} connection(s) for ${owner}/${repo};`,
        github.capabilities.map((c) => `${c.environmentName}=${c.capability}`),
      );
    }

    return {
      ok: true,
      configured: true,
      matches: matched,
      environments: [...envMatches.values()].sort((a, b) => a.name.localeCompare(b.name)),
      dashboardUrl: dashboardBase(settings),
      github,
    };
  } catch (err) {
    const message = err instanceof TestkubeError ? err.message : String(err);
    logError('GET_MATCHES failed:', message);
    return { ok: false, configured: true, matches: [], environments: [], error: message };
  }
}

// ---- GET_PULL_REQUEST -------------------------------------------------------

// The newest event for a PR in an environment, paging through the repo's
// event log (newest first) up to a small bound.
async function findPullRequestEvent(
  s: Settings,
  orgId: string,
  envId: string,
  repositoryId: string,
  number: number,
): Promise<GithubRepositoryIntegrationEvent | undefined> {
  for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
    const list = await listGithubIntegrationEvents(s, orgId, envId, repositoryId, page, EVENTS_PAGE_SIZE);
    const events = (list.events ?? []).filter((e) => isPullRequestEvent(e) && e.issueNumber === number);
    if (events.length > 0) {
      return events.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
    }
    if (!list.hasMore) break;
  }
  return undefined;
}

async function handleGetPullRequest(
  owner: string,
  repo: string,
  number: number,
  force: boolean,
): Promise<PullRequestResponse> {
  const settings = await getSettings();
  const base: PullRequestResponse = {
    ok: true,
    configured: isConfigured(settings),
    enabled: settings.githubAppIntegration,
    capabilities: [],
    featureDisabled: false,
    connected: false,
    runs: [],
  };
  if (!base.configured || !base.enabled) return base;
  const hostError = await hostAccessError(settings);
  if (hostError) return { ...base, ok: false, error: hostError };

  const repoRef: RepoRef = { host: 'github.com', owner, repo };
  const fullName = `${owner}/${repo}`;
  try {
    const { orgId, environments } = await discover(settings, force);
    const cache = await loadGithubCache(cacheSignature(settings));
    const scan = await scanGithubApp(settings, orgId, environments, cache, force);
    const repositoryId = await resolveRepositoryId(settings, orgId, scan.capable, fullName, cache, force);
    await chrome.storage.local.set({ [GITHUB_CACHE_KEY]: cache });

    base.capabilities = scan.capabilities;
    base.featureDisabled = scan.featureDisabled;
    base.dashboardUrl = dashboardBase(settings);
    if (!repositoryId) {
      if (scan.capable.length > 0) {
        base.connectUrl = buildConnectUrl(settings, orgId, scan.capable[0].id);
      }
      return base;
    }

    const connectedEnvs = scan.capable.filter((env) =>
      env.integrations.some((i) => i.repositoryId === repositoryId),
    );
    base.connected = connectedEnvs.length > 0;
    if (!base.connected) {
      if (scan.capable.length > 0) {
        base.connectUrl = buildConnectUrl(settings, orgId, scan.capable[0].id, repositoryId);
      }
      return base;
    }

    const runs: PullRequestRun[] = [];
    await mapWithConcurrency(connectedEnvs, ENV_CONCURRENCY, async (env) => {
      let event: GithubRepositoryIntegrationEvent | undefined;
      try {
        event = await findPullRequestEvent(settings, orgId, env.id, repositoryId, number);
      } catch (err) {
        warn(`PR #${number} event lookup failed in env "${env.name}":`, err);
        return;
      }
      if (!event) return;

      // The event list does not carry the head SHA; the parent execution's own
      // event context does (read only, never linked). Best effort: the panel
      // still renders without it.
      let headSha: string | undefined;
      if (event.executionId) {
        try {
          const execEvents = await listExecutionIntegrationEvents(settings, orgId, env.id, event.executionId);
          const match = execEvents.find((e) => e.id === event?.id) ?? execEvents[0];
          headSha = match?.context?.github?.headSha;
        } catch (err) {
          log(`head SHA lookup failed for execution ${event.executionId}:`, err);
        }
      }

      const children: PullRequestChild[] = (event.children ?? []).map((c) => ({
        id: c.id,
        workflowName: c.workflowName,
        status: c.status,
        url: buildExecutionDetailsUrl(settings, orgId, env.id, c.id),
      }));

      runs.push({
        environmentId: env.id,
        environmentName: env.name,
        repositoryId,
        eventId: event.id,
        eventStatus: event.status,
        action: event.action,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt ?? event.createdAt,
        headSha,
        qualityGates: event.qualityGates ?? [],
        lastMessage: event.lastMessage,
        aiSessionUrl: event.aiSessionId
          ? buildAiSessionUrl(settings, orgId, env.id, event.aiSessionId)
          : undefined,
        children,
        overall: deriveOverall(event),
      });
    });

    base.runs = runs.sort((a, b) => a.environmentName.localeCompare(b.environmentName));
    log(`PR #${number} on ${repoRef.owner}/${repoRef.repo}: ${runs.length} run(s)`);
    return base;
  } catch (err) {
    const message = err instanceof TestkubeError ? err.message : String(err);
    logError('GET_PULL_REQUEST failed:', message);
    return { ...base, ok: false, error: message };
  }
}

// ---- Message router ---------------------------------------------------------

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  if (request.type === 'GET_MATCHES') {
    log(`GET_MATCHES received for ${request.owner}/${request.repo}${request.force ? ' (force)' : ''}`);
    handleGetMatches(request.owner, request.repo, Boolean(request.force))
      .then((res) => {
        log('GET_MATCHES response:', res);
        sendResponse(res);
      })
      .catch((err) => {
        logError('GET_MATCHES handler threw:', err);
        sendResponse({ ok: false, configured: true, matches: [], environments: [], error: String(err) });
      });
    return true; // keep the message channel open for the async response
  }
  if (request.type === 'GET_PULL_REQUEST') {
    log(
      `GET_PULL_REQUEST received for ${request.owner}/${request.repo}#${request.number}${
        request.force ? ' (force)' : ''
      }`,
    );
    handleGetPullRequest(request.owner, request.repo, request.number, Boolean(request.force))
      .then((res) => {
        log('GET_PULL_REQUEST response:', res);
        sendResponse(res);
      })
      .catch((err) => {
        logError('GET_PULL_REQUEST handler threw:', err);
        sendResponse({
          ok: false,
          configured: true,
          enabled: true,
          capabilities: [],
          featureDisabled: false,
          connected: false,
          runs: [],
          error: String(err),
        });
      });
    return true;
  }
  return false;
});
