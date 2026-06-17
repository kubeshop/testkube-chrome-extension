import { log } from '../lib/log';
import type { MatchedWorkflow, MatchesResponse } from '../lib/messaging';
import widgetCss from './widget.css?inline';

export const HOST_ID = 'testkube-gh-widget-host';
const STYLE_ID = 'testkube-gh-widget-style';

// In-memory UI state (persists across GitHub's soft navigations while the content
// script stays alive). The last response is kept so the environment dropdown can
// re-render the panel without re-querying the API.
let lastRendered: MatchesResponse | null = null;
let selectedEnvId = '';

// Registered by the content script; invoked when the user clicks the refresh icon.
let onRefresh: (() => void) | null = null;

export function setOnRefresh(fn: () => void): void {
  onRefresh = fn;
}

const SYNC_ICON =
  'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .655-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z';

// The Testkube "kubie" symbol (the gradient cube mark), inlined so it renders
// without an extra asset request. The gradient id is namespaced to avoid
// clashing with anything on the GitHub page.
const KUBIE_ICON =
  '<svg class="tk-gh-kubie" viewBox="0 0 35 43" width="12" height="15" fill="none" aria-hidden="true">' +
  '<path d="M33.484 15.67 18.45.588a2.005 2.005 0 0 0-2.827 0L.586 15.669c-.373.374-.584.88-.586 1.41v7.852c.002.53.213 1.036.586 1.41l15.036 15.08a2.004 2.004 0 0 0 2.827 0l15.035-15.08c.374-.374.585-.88.587-1.41V17.08a2.004 2.004 0 0 0-.587-1.41Zm-1.25 8.255L29.33 21.01l2.903-2.911v5.825Zm-4.158-4.172L17.923 9.567V2.576l13.638 13.68-3.485 3.497ZM7.25 21.009l9.786-9.816 9.787 9.816-9.787 9.818-9.786-9.818Zm8.899-18.433v6.99L5.994 19.754 2.51 16.255l13.639-13.68Zm.887 37.758v-6.992l11.041-11.074 3.485 3.505-14.526 14.561Z" fill="url(#tk-gh-kubie-gradient)"/>' +
  '<defs><linearGradient id="tk-gh-kubie-gradient" x1="6.147" y1="31.93" x2="27.989" y2="10.155" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#B0B5D8"/><stop offset=".13" stop-color="#9E9DD4"/><stop offset=".41" stop-color="#7A70CB"/>' +
  '<stop offset=".66" stop-color="#604FC5"/><stop offset=".86" stop-color="#513AC1"/><stop offset="1" stop-color="#4B33C0"/>' +
  '</linearGradient></defs></svg>';

function buildKubieIcon(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'tk-gh-kubie-wrap';
  span.innerHTML = KUBIE_ICON;
  return span;
}

function buildRefreshButton(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tk-gh-refresh';
  btn.title = 'Refresh Testkube data';
  btn.setAttribute('aria-label', 'Refresh Testkube data');
  btn.innerHTML = `<svg class="tk-gh-octicon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${SYNC_ICON}"></path></svg>`;
  btn.addEventListener('click', () => {
    btn.classList.add('tk-gh-refresh--spinning');
    onRefresh?.();
  });
  return btn;
}

// Inject a placeholder "Tests Executed" section with a spinner while the first
// query for a repo is in flight. An optional dashboard URL is shown so the link
// is available before results arrive.
export function renderLoading(dashboardUrl?: string): void {
  ensureStyles();
  removeWidget();
  const content = document.createElement('div');

  const row = document.createElement('div');
  row.className = 'tk-gh-loading';
  row.innerHTML =
    `<span class="tk-gh-loading-spinner"><svg class="tk-gh-octicon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${SYNC_ICON}"></path></svg></span>` +
    `<span>Loading test workflows…</span>`;
  content.appendChild(row);

  if (injectIntoSidebar(content, 0, false, dashboardUrl)) {
    log('renderLoading: injected loading state');
  }
}

// Headings (by text) we will try to insert our section above, in priority order.
const ANCHOR_HEADINGS = ['Releases', 'Packages', 'Deployments', 'Languages'];

type StatusKind = 'passed' | 'failed' | 'aborted' | 'canceled' | 'running' | 'other' | 'unknown';

function statusKind(status?: string): StatusKind {
  switch ((status ?? '').toLowerCase()) {
    case 'passed':
      return 'passed';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'aborted':
    case 'aborting':
      return 'aborted';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'running':
    case 'queued':
    case 'assigned':
    case 'paused':
      return 'running';
    case '':
      return 'unknown';
    default:
      return 'other';
  }
}

// Octicon SVGs (16px). check/x-circle-fill match GitHub's Deployments icons;
// the others use a solid disc of the same visual weight, colored per status.
const DISC = 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Z';
const ICON_PATHS: Record<StatusKind, string> = {
  passed:
    'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l1.47 1.47 3.97-3.97a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z',
  failed:
    'M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z',
  aborted: DISC,
  canceled: DISC,
  running: DISC,
  other: DISC,
  unknown: DISC,
};

function octicon(kind: StatusKind): HTMLElement {
  const span = document.createElement('span');
  span.className = `tk-gh-icon tk-gh-icon--${kind}`;
  span.innerHTML = `<svg class="tk-gh-octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${ICON_PATHS[kind]}"></path></svg>`;
  return span;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = widgetCss;
  document.head.appendChild(style);
}

// Popovers are mounted on document.body (not inside the GitHub section) so they
// can never be clipped by an ancestor's overflow or stacking context. Track
// their teardown so we can remove them when the widget is re-rendered/removed.
let popoverCleanups: Array<() => void> = [];

function runPopoverCleanups(): void {
  for (const fn of popoverCleanups) fn();
  popoverCleanups = [];
}

export function removeWidget(): void {
  runPopoverCleanups();
  document.getElementById(HOST_ID)?.remove();
}

export function renderWidget(res: MatchesResponse): void {
  removeWidget();
  if (res.configured && res.ok && res.matches.length === 0) {
    log('renderWidget: configured but 0 matches, staying silent');
    return;
  }
  ensureStyles();
  lastRendered = res;

  // Resolve the effective selection: keep the user's choice if it still applies,
  // otherwise default to the environment with the most matches.
  selectedEnvId = effectiveEnvId(res);

  const content = buildContent(res);
  const total = res.configured && res.ok ? visibleMatches(res).length : 0;
  const showRefresh = res.configured && res.ok;
  const headerUrl = res.configured && res.ok ? currentDashboardUrl(res) : undefined;
  const envName = res.configured && res.ok ? selectedEnvName(res) : undefined;
  const headerTooltip = envName
    ? `Test Workflows in the ${envName} Testkube Environment that run tests in this repository`
    : undefined;
  if (injectIntoSidebar(content, total, showRefresh, headerUrl, headerTooltip)) {
    log('renderWidget: injected "Tests Executed" section into sidebar');
  } else {
    log('renderWidget: sidebar section not found, skipping injection');
  }
}

// The environment to show: the current selection if still present, else the one
// with the most matches.
function effectiveEnvId(res: MatchesResponse): string {
  if (selectedEnvId && res.environments.some((e) => e.id === selectedEnvId)) return selectedEnvId;
  return [...res.environments].sort((a, b) => b.matchCount - a.matchCount)[0]?.id ?? '';
}

// Matches limited to the currently selected environment.
function visibleMatches(res: MatchesResponse): MatchedWorkflow[] {
  return res.matches.filter((m) => m.environmentId === selectedEnvId);
}

// A grey count rendered after the "Tests Executed" label, mirroring how GitHub
// shows the number of releases next to the "Releases" heading.
function appendHeadingCount(heading: HTMLElement, total: number): void {
  if (total <= 0) return;
  const count = document.createElement('span');
  count.className = 'tk-gh-heading-count';
  count.textContent = String(total);
  heading.append(count);
}

// Build the inner content (optional env dropdown + summary + hover popover, or a notice).
function buildContent(res: MatchesResponse): HTMLElement {
  if (!res.configured) {
    return buildNotice('Open the extension options to set your Testkube API token.');
  }
  if (!res.ok) {
    return buildNotice(res.error ?? 'Failed to query Testkube.');
  }

  const container = document.createElement('div');

  // Only offer a selector when matches span more than one environment.
  if (res.environments.length > 1) {
    container.appendChild(buildEnvironmentSelect(res));
  }

  container.appendChild(buildSummary(visibleMatches(res), currentExecutionsUrl(res)));
  return container;
}

// Dashboard URL for the selected environment (used by the header title link).
function currentDashboardUrl(res: MatchesResponse): string | undefined {
  return res.environments.find((e) => e.id === selectedEnvId)?.dashboardUrl;
}

// Executions list URL for the selected environment (used by the status labels).
function currentExecutionsUrl(res: MatchesResponse): string | undefined {
  return res.environments.find((e) => e.id === selectedEnvId)?.executionsUrl;
}

function selectedEnvName(res: MatchesResponse): string | undefined {
  return res.environments.find((e) => e.id === selectedEnvId)?.name;
}

function buildEnvironmentSelect(res: MatchesResponse): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tk-gh-env';

  const select = document.createElement('select');
  select.className = 'tk-gh-env-select';

  for (const env of res.environments) {
    const option = document.createElement('option');
    option.value = env.id;
    option.textContent = `${env.name} (${env.matchCount})`;
    select.appendChild(option);
  }

  select.value = selectedEnvId;
  select.addEventListener('change', () => {
    selectedEnvId = select.value;
    if (lastRendered) renderWidget(lastRendered);
  });

  wrap.appendChild(select);
  return wrap;
}

function buildNotice(detail: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tk-gh-notice-detail';
  el.textContent = detail;
  return el;
}

// Status buckets shown in the summary, in display order. `passed` and `failed`
// are always shown; the rest only appear when there is at least one workflow.
const SUMMARY_ORDER: Array<{ kind: StatusKind; label: string; always: boolean }> = [
  { kind: 'passed', label: 'passed', always: true },
  { kind: 'failed', label: 'failed', always: true },
  { kind: 'aborted', label: 'aborted', always: false },
  { kind: 'canceled', label: 'cancelled', always: false },
  { kind: 'running', label: 'running', always: false },
];

function buildSummary(matches: MatchedWorkflow[], executionsUrl?: string): HTMLElement {
  const groups = new Map<StatusKind, MatchedWorkflow[]>();
  for (const m of matches) {
    const kind = statusKind(m.status);
    const bucket = groups.get(kind) ?? [];
    bucket.push(m);
    groups.set(kind, bucket);
  }

  const summary = document.createElement('div');
  summary.className = 'tk-gh-summary';

  for (const { kind, label, always } of SUMMARY_ORDER) {
    const items = groups.get(kind) ?? [];
    if (items.length === 0 && !always) continue;

    const stat = buildStat(kind, items.length, label, executionsUrl);
    if (items.length > 0) {
      stat.tabIndex = 0;
      stat.classList.add('tk-gh-stat--interactive');
      const noun = `${label} workflow${items.length === 1 ? '' : 's'}`;
      attachPopover(stat, buildPopover(`${items.length} ${noun}`, items));
    }
    summary.appendChild(stat);
  }

  return summary;
}

function buildPopover(titleText: string, items: MatchedWorkflow[]): HTMLElement {
  const popover = document.createElement('div');
  popover.className = 'tk-gh-popover';

  const title = document.createElement('div');
  title.className = 'tk-gh-popover-title';
  title.textContent = titleText;
  popover.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'tk-gh-list';
  for (const m of items) list.appendChild(buildListItem(m));
  popover.appendChild(list);

  return popover;
}

// Wire a body-mounted popover to a trigger element, opening to the right of the
// trigger (flipping left only when there is not enough room) and clamped to the
// viewport.
function attachPopover(trigger: HTMLElement, popover: HTMLElement): void {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const position = (): void => {
    const r = trigger.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;

    let left = r.right + gap;
    if (left + pw > window.innerWidth - margin) {
      const leftAlt = r.left - gap - pw;
      left = leftAlt >= margin ? leftAlt : Math.max(margin, window.innerWidth - margin - pw);
    }

    let top = r.top;
    if (top + ph > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - ph);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const show = (): void => {
    if (hideTimer) clearTimeout(hideTimer);
    if (!popover.isConnected) document.body.appendChild(popover);
    popover.style.visibility = 'hidden';
    popover.style.display = 'block';
    position();
    popover.style.visibility = 'visible';
  };

  const hide = (): void => {
    popover.style.display = 'none';
  };

  const scheduleHide = (): void => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  };

  const onScrollResize = (): void => {
    if (popover.style.display === 'block') position();
  };

  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', scheduleHide);
  trigger.addEventListener('focusin', show);
  trigger.addEventListener('focusout', scheduleHide);
  popover.addEventListener('mouseenter', show);
  popover.addEventListener('mouseleave', scheduleHide);
  window.addEventListener('scroll', onScrollResize, true);
  window.addEventListener('resize', onScrollResize);

  popoverCleanups.push(() => {
    if (hideTimer) clearTimeout(hideTimer);
    window.removeEventListener('scroll', onScrollResize, true);
    window.removeEventListener('resize', onScrollResize);
    popover.remove();
  });
}

// Stable IDs of the dashboard's prepopulated executions views. A status bucket
// links to its matching view's pre-filtered list; buckets without a predefined
// view (e.g. cancelled) fall back to the unfiltered executions list.
const STATUS_VIEW_IDS: Partial<Record<StatusKind, string>> = {
  passed: 'default-passed-executions',
  failed: 'default-failed-executions',
  aborted: 'default-aborted-executions',
  running: 'default-running-executions',
};

function statusExecutionsUrl(executionsUrl: string | undefined, kind: StatusKind): string | undefined {
  if (!executionsUrl) return undefined;
  const viewId = STATUS_VIEW_IDS[kind];
  return viewId ? `${executionsUrl}/views/${viewId}` : executionsUrl;
}

function buildStat(
  kind: StatusKind,
  count: number,
  label: string,
  executionsUrl?: string,
): HTMLElement {
  const stat = document.createElement('span');
  stat.className = 'tk-gh-stat';

  const value = document.createElement('span');
  value.className = 'tk-gh-count';
  value.textContent = String(count);

  // The label links to the matching prefiltered executions view when available.
  const href = statusExecutionsUrl(executionsUrl, kind);
  let text: HTMLElement;
  if (href) {
    const link = document.createElement('a');
    link.className = 'tk-gh-stat-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    text = link;
  } else {
    text = document.createElement('span');
    text.textContent = label;
  }

  stat.append(octicon(kind), value, text);
  return stat;
}

function buildListItem(m: MatchedWorkflow): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tk-gh-item';

  const link = document.createElement('a');
  link.className = 'tk-gh-link';
  link.href = m.dashboardUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = m.name;
  link.title = m.name;

  const status = document.createElement('span');
  status.className = 'tk-gh-item-status';
  status.textContent = m.status ?? 'no runs';

  li.append(octicon(statusKind(m.status)), link, status);
  return li;
}

// Find a sidebar section by heading text and insert a native-looking
// "Tests Executed" section above it, cloning the row/cell/heading classes so it
// visually matches GitHub regardless of the (possibly hashed) class names.
const HEADER_TITLE = 'Test Results';

function injectIntoSidebar(
  content: HTMLElement,
  total: number,
  showRefresh: boolean,
  headerUrl?: string,
  headerTooltip?: string,
): boolean {
  const found = findAnchorHeading();
  if (!found) return false;

  const { heading, wrapper } = found;
  const cell = heading.parentElement;
  if (!cell || !wrapper.parentElement) return false;

  const section = wrapper.cloneNode(false) as HTMLElement;
  section.id = HOST_ID;
  section.removeAttribute('data-testid');

  let mountPoint: HTMLElement = section;
  if (wrapper !== cell) {
    const cellClone = cell.cloneNode(false) as HTMLElement;
    cellClone.removeAttribute('data-testid');
    section.appendChild(cellClone);
    mountPoint = cellClone;
  }

  const newHeading = heading.cloneNode(false) as HTMLElement;
  newHeading.removeAttribute('data-testid');
  newHeading.removeAttribute('id');
  // Miniature Testkube "kubie" mark in front of the title.
  newHeading.appendChild(buildKubieIcon());
  // Like GitHub's sidebar section headers, make the title itself a link.
  if (headerUrl) {
    const titleLink = document.createElement('a');
    titleLink.className = 'tk-gh-heading-link';
    titleLink.href = headerUrl;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = HEADER_TITLE;
    if (headerTooltip) titleLink.title = headerTooltip;
    newHeading.appendChild(titleLink);
  } else {
    const titleText = document.createElement('span');
    titleText.textContent = HEADER_TITLE;
    if (headerTooltip) titleText.title = headerTooltip;
    newHeading.appendChild(titleText);
  }
  appendHeadingCount(newHeading, total);
  if (showRefresh) newHeading.appendChild(buildRefreshButton());

  mountPoint.append(newHeading, content);
  wrapper.parentElement.insertBefore(section, wrapper);
  return true;
}

function findAnchorHeading(): { heading: HTMLElement; wrapper: HTMLElement } | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('h2, h3'));
  for (const target of ANCHOR_HEADINGS) {
    // Section headings often include a count (e.g. "Releases 93"), so match on
    // the first word rather than the full text.
    const heading = headings.find((h) => {
      const text = (h.textContent ?? '').trim();
      return text === target || text.split(/\s+/)[0] === target;
    });
    if (!heading) continue;
    const wrapper =
      heading.closest<HTMLElement>('.BorderGrid-row') ??
      heading.closest<HTMLElement>('[class*="BorderGrid-row"]') ??
      heading.parentElement;
    if (wrapper) {
      log(`anchor heading "${target}" found`);
      return { heading, wrapper };
    }
  }
  return null;
}
