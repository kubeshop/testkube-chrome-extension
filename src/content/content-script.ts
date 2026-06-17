import { parseGithubRepoFromPath, type RepoRef } from '../lib/match';
import { log, warn } from '../lib/log';
import type { GetMatchesRequest, MatchesResponse } from '../lib/messaging';
import { HOST_ID, removeWidget, renderWidget } from './widget';

log('content script loaded on', location.href);

let currentKey = '';
let lastResponse: MatchesResponse | null = null;
let scheduled = false;

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

async function update(): Promise<void> {
  const ref = parseGithubRepoFromPath(location.pathname);
  if (!ref || !isCodeTab(location.pathname)) {
    removeWidget();
    currentKey = '';
    lastResponse = null;
    return;
  }

  const key = keyFor(ref);

  // Same repo: only need to (re)render if our widget was removed by GitHub.
  if (key === currentKey) {
    if (document.getElementById(HOST_ID)) return;
    if (lastResponse) {
      log('re-rendering widget for', key, '(host was removed)');
      renderWidget(lastResponse);
    }
    return;
  }

  currentKey = key;
  lastResponse = null;
  log('detected repo', key, '- requesting matches from service worker');

  const req: GetMatchesRequest = { type: 'GET_MATCHES', owner: ref.owner, repo: ref.repo };
  let res: MatchesResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as MatchesResponse | undefined;
  } catch (err) {
    warn('sendMessage failed (worker unavailable / context invalidated):', err);
    return;
  }
  log('received response for', key, ':', res);
  if (!res) return;

  // Guard against navigation that happened during the async round-trip.
  const now = parseGithubRepoFromPath(location.pathname);
  if (!now || keyFor(now) !== key) return;

  lastResponse = res;
  renderWidget(res);
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

void update();
