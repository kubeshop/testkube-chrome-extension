import { getSettings, isConfigured } from '../lib/storage';
import {
  getLatestExecution,
  listEnvironments,
  listOrganizations,
  listWorkflows,
  TestkubeError,
} from '../lib/testkube';
import { extractGitUris, workflowMatchesRepo, type RepoRef } from '../lib/match';
import { log, warn, error as logError } from '../lib/log';
import type {
  MatchedEnvironment,
  MatchedWorkflow,
  MatchesResponse,
  RuntimeRequest,
} from '../lib/messaging';
import type { Environment, Settings } from '../lib/types';

log('service worker loaded');

const CACHE_TTL_MS = 3 * 60 * 1000;
const STATUS_CONCURRENCY = 8;
const ENV_CONCURRENCY = 4;
const DISCOVERY_CACHE_KEY = 'discoveryCache';
const WORKFLOWS_CACHE_KEY = 'workflowsCache';

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

interface DiscoveryCache {
  sig: string;
  fetchedAt: number;
  orgId: string;
  environments: Array<{ id: string; name: string }>;
}

interface WorkflowsCache {
  sig: string;
  entries: Record<string, { fetchedAt: number; workflows: unknown[] }>;
}

// Resolve the org id and the token-accessible environments, cached with a TTL.
async function discover(
  s: Settings,
  force: boolean,
): Promise<{ orgId: string; environments: Array<{ id: string; name: string }> }> {
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

function buildEnvironmentBase(s: Settings, orgId: string, envId: string): string {
  const base = s.dashboardBaseUrl.replace(/\/+$/, '');
  return `${base}/organization/${encodeURIComponent(orgId)}/environment/${encodeURIComponent(
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

async function handleGetMatches(
  owner: string,
  repo: string,
  force: boolean,
): Promise<MatchesResponse> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    log('not configured (missing apiBaseUrl/apiToken)');
    return { ok: true, configured: false, matches: [], environments: [] };
  }

  const repoRef: RepoRef = { host: 'github.com', owner, repo };
  try {
    const { orgId, environments } = await discover(settings, force);

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
        const { matches, gitUris } = workflowMatchesRepo(wf, repoRef);
        if (!matches) {
          if (matched.length === 0) for (const uri of extractGitUris(wf)) allUris.add(uri);
          continue;
        }
        const name = getWorkflowName(wf);
        if (!name) continue;
        matched.push({
          name,
          gitUris,
          environmentId: env.id,
          environmentName: env.name,
          // Default to the workflow's Executions tab; replaced with a direct
          // link to the latest execution once we know its id (below).
          dashboardUrl: buildWorkflowExecutionsUrl(settings, orgId, env.id, name),
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

    return {
      ok: true,
      configured: true,
      matches: matched,
      environments: [...envMatches.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (err) {
    const message = err instanceof TestkubeError ? err.message : String(err);
    logError('GET_MATCHES failed:', message);
    return { ok: false, configured: true, matches: [], environments: [], error: message };
  }
}

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
  return false;
});
