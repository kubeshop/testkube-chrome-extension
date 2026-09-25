import { parseGithubRepoFromPath, repoMatchesPatterns, type RepoRef } from '../lib/match';
import { log, warn } from '../lib/log';
import { getSettings } from '../lib/storage';
import type {
  GetMatchesRequest,
  GetPullRequestRequest,
  MatchesResponse,
  PullRequestResponse,
} from '../lib/messaging';
import { HOST_ID, removeWidget, renderLoading, renderWidget, setOnRefresh } from './widget';
import {
  PR_HOST_ID,
  removePrWidget,
  renderPrLoading,
  renderPrWidget,
  setOnPrRefresh,
} from './pr-widget';

log('content script loaded on', location.href);

// ---- Repo (Code tab) panel state -------------------------------------------
let currentKey = '';
let lastResponse: MatchesResponse | null = null;
let pending = false;

// ---- Pull request panel state ----------------------------------------------
let currentPrKey = '';
let lastPrResponse: PullRequestResponse | null = null;
let prPending = false;

let scheduled = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let dashboardBaseUrl = '';
let repoFilters: string[] = [];
let githubAppEnabled = true;
// Bumped whenever a setting that changes what we render flips, so responses
// to requests started under the old setting are discarded instead of rendered.
let settingsEpoch = 0;

function loadingDashboardUrl(): string | undefined {
  const base = dashboardBaseUrl.replace(/\/+$/, '');
  return base || undefined;
}

// Only inject on the repo home / Code tab: /owner/repo or /owner/repo/(tree|blob)/...
function isCodeTab(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2) return true;
  if (parts.length >= 3 && (parts[2] === 'tree' || parts[2] === 'blob')) return true;
  return false;
}

// The PR conversation tab: /owner/repo/pull/123 (the Files/Checks tabs have
// no sidebar to inject into).
function pullRequestNumber(pathname: string): number | undefined {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3])) return Number(parts[3]);
  return undefined;
}

function keyFor(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

// The PR's current head commit, read from the timeline's commit links (the
// last one is the newest). Undefined when the page has none we recognize.
function readPageHeadSha(ref: RepoRef, number: number): string | undefined {
  const prefix = `/${ref.owner}/${ref.repo}/pull/${number}/commits/`;
  const links = document.querySelectorAll<HTMLAnchorElement>(`a[href^="${prefix}"]`);
  let sha: string | undefined;
  for (const a of links) {
    const m = a.getAttribute('href')?.slice(prefix.length).match(/^([0-9a-f]{40})/i);
    if (m) sha = m[1];
  }
  return sha;
}

// ---- Repo panel ---------------------------------------------------------------

async function updateRepo(ref: RepoRef, force: boolean): Promise<void> {
  const key = keyFor(ref);
  // A repo is "active" automatically when Testkube has a workflow for it (known
  // only after querying), OR when it explicitly matches a manual pattern. Manual
  // matches are known up front, so we can show the loading state immediately;
  // other repos are queried silently and only render if a workflow exists.
  const manual = repoMatchesPatterns(ref, repoFilters);

  // Same repo (and not a forced refresh): only (re)render if GitHub removed us.
  if (!force && key === currentKey) {
    if (document.getElementById(HOST_ID)) return;
    if (lastResponse) {
      log('re-rendering widget for', key, '(host was removed)');
      renderWidget(lastResponse);
    } else if (pending && manual) {
      renderLoading(loadingDashboardUrl());
    }
    return;
  }

  currentKey = key;
  if (!force) {
    lastResponse = null;
    pending = true;
    // Only flash a loading placeholder for repos we already know are active.
    if (manual) renderLoading(loadingDashboardUrl());
    else removeWidget();
  }
  log('detected repo', key, force ? '- forcing refresh' : '- requesting matches from service worker');

  const req: GetMatchesRequest = { type: 'GET_MATCHES', owner: ref.owner, repo: ref.repo, force };
  const epoch = settingsEpoch;
  let res: MatchesResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as MatchesResponse | undefined;
  } catch (err) {
    warn('sendMessage failed (worker unavailable / context invalidated):', err);
    pending = false;
    return;
  }
  pending = false;
  log('received response for', key, ':', res);
  if (!res) return;
  // Settings changed while the request was in flight: a fresh query is already
  // on its way, so drop this one rather than render stale state.
  if (epoch !== settingsEpoch) return;

  // Guard against navigation that happened during the async round-trip.
  const now = parseGithubRepoFromPath(location.pathname);
  if (!now || keyFor(now) !== key || !isCodeTab(location.pathname)) return;

  // Render when Testkube has workflows for the repo or it is connected through
  // the GitHub App (auto-active), or the user explicitly allowlisted it (shows
  // the create/connect empty state).
  const hasMatches = res.configured && res.ok && res.matches.length > 0;
  const connected = res.configured && res.ok && (res.github?.connections.length ?? 0) > 0;
  if (hasMatches || connected || manual) {
    lastResponse = res;
    renderWidget(res);
  } else {
    lastResponse = null;
    removeWidget();
  }
}

// ---- Pull request panel --------------------------------------------------------

async function updatePullRequest(ref: RepoRef, number: number, force: boolean): Promise<void> {
  const key = `${keyFor(ref)}#${number}`;
  const manual = repoMatchesPatterns(ref, repoFilters);

  if (!force && key === currentPrKey) {
    if (document.getElementById(PR_HOST_ID)) return;
    if (lastPrResponse) {
      log('re-rendering PR panel for', key, '(host was removed)');
      renderPrWidget(lastPrResponse, readPageHeadSha(ref, number));
    } else if (prPending && manual) {
      renderPrLoading();
    }
    return;
  }

  currentPrKey = key;
  if (!force) {
    lastPrResponse = null;
    prPending = true;
    if (manual) renderPrLoading();
    else removePrWidget();
  }
  log('detected pull request', key, force ? '- forcing refresh' : '- requesting run from service worker');

  const req: GetPullRequestRequest = {
    type: 'GET_PULL_REQUEST',
    owner: ref.owner,
    repo: ref.repo,
    number,
    force,
  };
  const epoch = settingsEpoch;
  let res: PullRequestResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as PullRequestResponse | undefined;
  } catch (err) {
    warn('sendMessage failed (worker unavailable / context invalidated):', err);
    prPending = false;
    return;
  }
  prPending = false;
  log('received PR response for', key, ':', res);
  if (!res) return;
  if (epoch !== settingsEpoch || !githubAppEnabled) return;

  const now = parseGithubRepoFromPath(location.pathname);
  if (!now || `${keyFor(now)}#${pullRequestNumber(location.pathname)}` !== key) return;

  // Stay out of the way unless the repo is connected through the GitHub App,
  // or the user allowlisted it (then show the connect / role notice).
  const show = res.configured && res.ok && res.enabled && (res.connected || manual);
  if (show || (manual && !res.ok)) {
    lastPrResponse = res;
    renderPrWidget(res, readPageHeadSha(ref, number));
  } else {
    lastPrResponse = null;
    removePrWidget();
  }
}

// ---- Dispatch ---------------------------------------------------------------------

function resetRepo(): void {
  removeWidget();
  currentKey = '';
  lastResponse = null;
  pending = false;
}

function resetPr(): void {
  removePrWidget();
  currentPrKey = '';
  lastPrResponse = null;
  prPending = false;
}

async function update(force = false): Promise<void> {
  const ref = parseGithubRepoFromPath(location.pathname);
  const prNumber = ref ? pullRequestNumber(location.pathname) : undefined;

  if (ref && isCodeTab(location.pathname)) {
    if (currentPrKey) resetPr();
    await updateRepo(ref, force);
    return;
  }
  if (ref && prNumber !== undefined && githubAppEnabled) {
    if (currentKey) resetRepo();
    await updatePullRequest(ref, prNumber, force);
    return;
  }
  if (currentKey) resetRepo();
  if (currentPrKey) resetPr();
}

function scheduleUpdate(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void update();
  }, 300);
}

// GitHub navigates via Turbo (soft navigation); also watch the DOM for the
// anchor reappearing after a client-side re-render.
document.addEventListener('turbo:load', scheduleUpdate);
document.addEventListener('pjax:end', scheduleUpdate);

const observer = new MutationObserver(scheduleUpdate);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Manual refresh from the panel icons: re-query, bypassing caches.
setOnRefresh(() => {
  void update(true);
});
setOnPrRefresh(() => {
  void update(true);
});

// Auto-refresh: re-query on an interval while viewing a repo or PR. 0 disables it.
function applyRefreshInterval(seconds: number): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (seconds > 0) {
    refreshTimer = setInterval(() => {
      // Only refresh while a panel is actually showing (skip inactive pages).
      const showing =
        (currentKey && document.getElementById(HOST_ID)) ||
        (currentPrKey && document.getElementById(PR_HOST_ID));
      if (showing) void update(true);
    }, seconds * 1000);
    log('auto-refresh every', seconds, 'seconds');
  }
}

// Load settings before the first render so the loading-state dashboard link and
// the auto-refresh interval are available.
void getSettings().then((s) => {
  dashboardBaseUrl = s.dashboardBaseUrl;
  repoFilters = s.repoFilters;
  githubAppEnabled = s.githubAppIntegration;
  applyRefreshInterval(s.refreshIntervalSeconds);
  void update();
});

// React to settings changes saved from the options page (stored in sync).
// Drop every panel and any in-flight response, then re-query (bypassing
// caches) so the page reflects the new settings immediately.
function requery(): void {
  settingsEpoch += 1;
  resetRepo();
  resetPr();
  void update(true);
}

chrome.storage.onChanged.addListener((changes, area) => {
  // The API token lives in local storage; a new token means new data.
  if (area === 'local') {
    if (changes.apiToken) requery();
    return;
  }
  if (area !== 'sync') return;
  if (changes.refreshIntervalSeconds) {
    applyRefreshInterval(Number(changes.refreshIntervalSeconds.newValue) || 0);
  }
  if (changes.dashboardBaseUrl) {
    dashboardBaseUrl = String(changes.dashboardBaseUrl.newValue ?? '');
  }
  if (changes.githubAppIntegration) {
    githubAppEnabled = changes.githubAppIntegration.newValue !== false;
  }
  // A different control plane, dashboard, or GitHub App setting changes what
  // (and where) the panels link to: fetch and render fresh data.
  if (changes.apiBaseUrl || changes.dashboardBaseUrl || changes.githubAppIntegration) {
    requery();
  }
  if (changes.repoFilters) {
    repoFilters = Array.isArray(changes.repoFilters.newValue)
      ? (changes.repoFilters.newValue as string[])
      : [];
    // Re-evaluate the current page against the updated allowlist.
    void update();
  }
});
