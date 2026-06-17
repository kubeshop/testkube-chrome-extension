import { getSettings, isConfigured } from '../lib/storage';
import { getLatestExecutionStatus, listWorkflows, TestkubeError } from '../lib/testkube';
import { extractGitUris, workflowMatchesRepo, type RepoRef } from '../lib/match';
import { log, error as logError } from '../lib/log';
import type { MatchedWorkflow, MatchesResponse, RuntimeRequest } from '../lib/messaging';
import type { Settings } from '../lib/types';

log('service worker loaded');

const CACHE_TTL_MS = 3 * 60 * 1000;
const STATUS_CONCURRENCY = 8;
const CACHE_STORAGE_KEY = 'workflowsCache';

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

interface WorkflowsCache {
  key: string; // orgId/environmentId
  fetchedAt: number;
  workflows: unknown[];
}

async function getWorkflows(s: Settings): Promise<unknown[]> {
  const key = `${s.orgId}/${s.environmentId}`;
  const stored = (await chrome.storage.local.get(CACHE_STORAGE_KEY))[CACHE_STORAGE_KEY] as
    | WorkflowsCache
    | undefined;
  if (stored && stored.key === key && Date.now() - stored.fetchedAt < CACHE_TTL_MS) {
    return stored.workflows;
  }
  const workflows = await listWorkflows(s);
  const entry: WorkflowsCache = { key, fetchedAt: Date.now(), workflows };
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: entry });
  return workflows;
}

function getWorkflowName(workflow: unknown): string | undefined {
  if (!workflow || typeof workflow !== 'object') return undefined;
  const obj = workflow as { name?: string; metadata?: { name?: string } };
  return obj.name ?? obj.metadata?.name;
}

function buildEnvironmentUrl(s: Settings): string {
  const base = s.dashboardBaseUrl.replace(/\/+$/, '');
  return `${base}/organization/${encodeURIComponent(s.orgId)}/environment/${encodeURIComponent(
    s.environmentId,
  )}/dashboard/test-workflows`;
}

function buildDashboardUrl(s: Settings, name: string): string {
  return `${buildEnvironmentUrl(s)}/${encodeURIComponent(name)}`;
}

async function handleGetMatches(owner: string, repo: string): Promise<MatchesResponse> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    log('not configured (missing apiBaseUrl/orgId/environmentId/apiToken)');
    return { ok: true, configured: false, matches: [] };
  }

  const repoRef: RepoRef = { host: 'github.com', owner, repo };
  try {
    const workflows = await getWorkflows(settings);
    log(`fetched ${workflows.length} workflow(s) for ${settings.orgId}/${settings.environmentId}`);

    const matched: MatchedWorkflow[] = [];
    for (const wf of workflows) {
      const { matches, gitUris } = workflowMatchesRepo(wf, repoRef);
      if (!matches) continue;
      const name = getWorkflowName(wf);
      if (!name) continue;
      matched.push({ name, gitUris, dashboardUrl: buildDashboardUrl(settings, name) });
    }
    log(
      `matched ${matched.length} workflow(s) for github.com/${owner}/${repo}`,
      matched.map((m) => m.name),
    );

    if (matched.length === 0 && workflows.length > 0) {
      const allUris = new Set<string>();
      for (const wf of workflows) for (const uri of extractGitUris(wf)) allUris.add(uri);
      log('no matches; git URIs discovered across workflows:', [...allUris]);
    }

    // Latest status for every matched workflow, with bounded concurrency.
    await mapWithConcurrency(matched, STATUS_CONCURRENCY, async (m) => {
      try {
        m.status = await getLatestExecutionStatus(settings, m.name);
      } catch (err) {
        log(`status lookup failed for "${m.name}":`, err);
      }
    });

    return {
      ok: true,
      configured: true,
      matches: matched,
      environmentUrl: buildEnvironmentUrl(settings),
    };
  } catch (err) {
    const message = err instanceof TestkubeError ? err.message : String(err);
    logError('GET_MATCHES failed:', message);
    return { ok: false, configured: true, matches: [], error: message };
  }
}

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  if (request.type === 'GET_MATCHES') {
    log(`GET_MATCHES received for ${request.owner}/${request.repo}`);
    handleGetMatches(request.owner, request.repo)
      .then((res) => {
        log('GET_MATCHES response:', res);
        sendResponse(res);
      })
      .catch((err) => {
        logError('GET_MATCHES handler threw:', err);
        sendResponse({ ok: false, configured: true, matches: [], error: String(err) });
      });
    return true; // keep the message channel open for the async response
  }
  return false;
});
