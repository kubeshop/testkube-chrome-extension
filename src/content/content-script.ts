import { parseGithubRepoFromPath, repoMatchesPatterns, type RepoRef } from '../lib/match';
import { log, warn } from '../lib/log';
import { getSettings } from '../lib/storage';
import type { GetMatchesRequest, MatchesResponse } from '../lib/messaging';
import { HOST_ID, removeWidget, renderLoading, renderWidget, setOnRefresh } from './widget';

log('content script loaded on', location.href);

let currentKey = '';
let lastResponse: MatchesResponse | null = null;
let pending = false;
let scheduled = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let dashboardBaseUrl = '';
let repoFilters: string[] = [];

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

function keyFor(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

async function update(force = false): Promise<void> {
  const ref = parseGithubRepoFromPath(location.pathname);
  if (!ref || !isCodeTab(location.pathname)) {
    removeWidget();
    currentKey = '';
    lastResponse = null;
    pending = false;
    return;
  }

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

  // Guard against navigation that happened during the async round-trip.
  const now = parseGithubRepoFromPath(location.pathname);
  if (!now || keyFor(now) !== key) return;

  // Render when Testkube has workflows for the repo (auto-active) or the user
  // explicitly allowlisted it (shows the create-a-workflow empty state).
  const hasMatches = res.configured && res.ok && res.matches.length > 0;
  if (hasMatches || manual) {
    lastResponse = res;
    renderWidget(res);
  } else {
    lastResponse = null;
    removeWidget();
  }
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

// Manual refresh from the panel icon: re-query, bypassing caches.
setOnRefresh(() => {
  void update(true);
});

// Auto-refresh: re-query on an interval while viewing a repo. 0 disables it.
function applyRefreshInterval(seconds: number): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (seconds > 0) {
    refreshTimer = setInterval(() => {
      // Only refresh while a panel is actually showing (skip inactive repos).
      if (currentKey && document.getElementById(HOST_ID)) void update(true);
    }, seconds * 1000);
    log('auto-refresh every', seconds, 'seconds');
  }
}

// Load settings before the first render so the loading-state dashboard link and
// the auto-refresh interval are available.
void getSettings().then((s) => {
  dashboardBaseUrl = s.dashboardBaseUrl;
  repoFilters = s.repoFilters;
  applyRefreshInterval(s.refreshIntervalSeconds);
  void update();
});

// React to settings changes saved from the options page (stored in sync).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.refreshIntervalSeconds) {
    applyRefreshInterval(Number(changes.refreshIntervalSeconds.newValue) || 0);
  }
  if (changes.dashboardBaseUrl) {
    dashboardBaseUrl = String(changes.dashboardBaseUrl.newValue ?? '');
  }
  if (changes.repoFilters) {
    repoFilters = Array.isArray(changes.repoFilters.newValue)
      ? (changes.repoFilters.newValue as string[])
      : [];
    // Re-evaluate the current page against the updated allowlist.
    void update();
  }
});
