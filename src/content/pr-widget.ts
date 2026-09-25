import {log} from '../lib/log';
import type {PullRequestResponse, PullRequestRun} from '../lib/messaging';
import {timeAgo} from '../lib/time';

import {SYNC_ICON, buildKubieIcon, buildRefreshButton, ensureStyles, externalLink, octicon, statusKind} from './widget';

// A native-looking sidebar item on pull request pages showing the GitHub
// App's latest run for the PR: overall status, child executions, quality
// gates, and links into Testkube.

export const PR_HOST_ID = 'testkube-gh-pr-host';

let onRefresh: (() => void) | null = null;

export function setOnPrRefresh(fn: () => void): void {
  onRefresh = fn;
}

export function removePrWidget(): void {
  document.getElementById(PR_HOST_ID)?.remove();
}

export function renderPrLoading(): void {
  ensureStyles();
  removePrWidget();
  const content = document.createElement('div');
  content.className = 'tk-gh-loading';
  content.innerHTML =
    `<span class="tk-gh-loading-spinner"><svg class="tk-gh-octicon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${SYNC_ICON}"></path></svg></span>` +
    `<span>Loading Testkube results…</span>`;
  injectIntoPrSidebar(content, undefined, false);
}

// Render the PR panel. `pageHeadSha` is the PR's current head commit as read
// from the page; a run for a different commit is flagged as stale.
export function renderPrWidget(res: PullRequestResponse, pageHeadSha?: string): void {
  ensureStyles();
  removePrWidget();

  const content = document.createElement('div');
  const headerUrl = res.dashboardUrl;

  if (!res.configured) {
    content.appendChild(notice('Open the extension options to set your Testkube API token.'));
  } else if (!res.ok) {
    content.appendChild(notice(res.error ?? 'Failed to query Testkube.'));
  } else if (!res.connected) {
    content.appendChild(buildNotConnected(res));
  } else if (res.runs.length === 0) {
    content.appendChild(notice('No Testkube runs for this pull request yet.'));
    const repoUrl = res.dashboardUrl;
    if (repoUrl) content.appendChild(linksRow([externalLink(repoUrl, 'Open Testkube →')]));
  } else {
    const showEnv = res.runs.length > 1;
    for (const run of res.runs) content.appendChild(buildRun(run, pageHeadSha, showEnv));
  }

  if (injectIntoPrSidebar(content, headerUrl, res.configured && res.ok)) {
    log('renderPrWidget: injected PR panel');
  } else {
    log('renderPrWidget: PR sidebar not found, skipping injection');
  }
}

function notice(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tk-gh-notice-detail';
  el.textContent = text;
  return el;
}

function linksRow(links: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tk-gh-empty-links';
  for (const l of links) row.appendChild(l);
  return row;
}

function buildNotConnected(res: PullRequestResponse): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tk-gh-empty';
  const capable = res.capabilities.some(c => c.capability === 'available');
  const forbidden = res.capabilities.some(c => c.capability === 'forbidden');

  const lead = document.createElement('p');
  lead.className = 'tk-gh-empty-text';
  if (res.connectUrl) {
    lead.textContent = 'This repository is not connected to Testkube through the GitHub App yet.';
    wrap.append(lead, linksRow([externalLink(res.connectUrl, 'Connect Testkube Bot →')]));
  } else if (!capable && forbidden) {
    lead.textContent = 'Your Testkube API token cannot access the GitHub App integration in any environment.';
    wrap.appendChild(lead);
  } else {
    lead.textContent = 'This repository is not connected to Testkube through the GitHub App yet.';
    wrap.appendChild(lead);
    if (res.dashboardUrl) wrap.appendChild(linksRow([externalLink(res.dashboardUrl, 'Open Testkube →')]));
  }
  return wrap;
}

const OVERALL_LABEL: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  aborted: 'Aborted',
  canceled: 'Cancelled',
};

function buildRun(run: PullRequestRun, pageHeadSha: string | undefined, showEnv: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tk-gh-pr-run';

  if (showEnv) {
    const env = document.createElement('div');
    env.className = 'tk-gh-pr-env';
    env.textContent = run.environmentName;
    wrap.appendChild(env);
  }

  // Headline: overall status, head commit, freshness.
  const kind = statusKind(run.overall);
  const head = document.createElement('div');
  head.className = 'tk-gh-pr-head';
  const label = document.createElement('span');
  label.className = 'tk-gh-pr-overall';
  label.textContent = OVERALL_LABEL[kind] ?? run.overall;
  head.append(octicon(kind), label);

  if (run.headSha) {
    const sha = document.createElement('span');
    sha.className = 'tk-gh-pr-sha';
    sha.textContent = run.headSha.slice(0, 7);
    sha.title = `Results for commit ${run.headSha}`;
    head.appendChild(sha);
    if (pageHeadSha && pageHeadSha.toLowerCase() !== run.headSha.toLowerCase()) {
      const stale = document.createElement('span');
      stale.className = 'tk-gh-pr-stale';
      stale.textContent = 'stale';
      stale.title = `Results are for an older commit (${run.headSha.slice(0, 7)}); the PR head is now ${pageHeadSha.slice(0, 7)}.`;
      head.appendChild(stale);
    }
  }
  const when = document.createElement('span');
  when.className = 'tk-gh-pr-when';
  when.textContent = [run.action, timeAgo(run.updatedAt)].filter(Boolean).join(' · ');
  head.appendChild(when);
  wrap.appendChild(head);

  // Child executions, one row each.
  if (run.children.length > 0) {
    const list = document.createElement('ul');
    list.className = 'tk-gh-pr-children';
    for (const c of run.children) {
      const li = document.createElement('li');
      li.className = 'tk-gh-pr-child';
      const link = externalLink(c.url, c.workflowName);
      link.title = c.workflowName;
      const status = document.createElement('span');
      status.className = 'tk-gh-item-status';
      status.textContent = c.status ?? 'queued';
      li.append(octicon(statusKind(c.status)), link, status);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  } else if (run.lastMessage && (run.eventStatus === 'failed' || run.eventStatus === 'skipped')) {
    const msg = document.createElement('div');
    msg.className = 'tk-gh-pr-message';
    msg.textContent = run.lastMessage;
    wrap.appendChild(msg);
  }

  // Quality gates configured for the repo.
  if (run.qualityGates.length > 0) {
    const gates = document.createElement('div');
    gates.className = 'tk-gh-pr-gates';
    gates.textContent = 'Gates: ' + run.qualityGates.map(g => `${g.type}${g.required ? ' (required)' : ''}`).join(', ');
    wrap.appendChild(gates);
  }

  const links: HTMLElement[] = [];
  if (run.aiSessionUrl) links.push(externalLink(run.aiSessionUrl, 'AI analysis →'));
  if (links.length > 0) wrap.appendChild(linksRow(links));

  return wrap;
}

// Insert our item at the top of the PR conversation sidebar, mirroring the
// classic `.discussion-sidebar-item` structure so it inherits GitHub's spacing.
function injectIntoPrSidebar(content: HTMLElement, headerUrl: string | undefined, showRefresh: boolean): boolean {
  const sidebar =
    document.getElementById('partial-discussion-sidebar') ??
    document.querySelector<HTMLElement>('#pr-conversation-sidebar');
  if (!sidebar) return false;
  const first = sidebar.querySelector<HTMLElement>('.discussion-sidebar-item');

  const item = document.createElement('div');
  item.id = PR_HOST_ID;
  item.className = 'discussion-sidebar-item tk-gh-pr-item';

  const heading = document.createElement('h3');
  heading.className = 'discussion-sidebar-heading text-bold tk-gh-pr-heading';
  heading.appendChild(buildKubieIcon());
  if (headerUrl) {
    const link = document.createElement('a');
    link.className = 'tk-gh-heading-link';
    link.href = headerUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Testkube';
    link.title = 'Open Testkube';
    heading.appendChild(link);
  } else {
    const text = document.createElement('span');
    text.textContent = 'Testkube';
    heading.appendChild(text);
  }
  if (showRefresh) heading.appendChild(buildRefreshButton(() => onRefresh?.()));

  item.append(heading, content);
  if (first) sidebar.insertBefore(item, first);
  else sidebar.prepend(item);
  return true;
}
