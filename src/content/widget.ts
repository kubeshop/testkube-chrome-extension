import { log } from '../lib/log';
import type { MatchedWorkflow, MatchesResponse } from '../lib/messaging';
import widgetCss from './widget.css?inline';

export const HOST_ID = 'testkube-gh-widget-host';
const STYLE_ID = 'testkube-gh-widget-style';

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

  const content = buildContent(res);
  const total = res.configured && res.ok ? res.matches.length : 0;
  if (injectIntoSidebar(content, total)) {
    log('renderWidget: injected "Tests Executed" section into sidebar');
  } else {
    log('renderWidget: sidebar section not found, using floating fallback');
    injectFloating(content, total);
  }
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

// Build the inner content (summary + hover popover, or a notice).
function buildContent(res: MatchesResponse): HTMLElement {
  if (!res.configured) {
    return buildNotice('Open the extension options to set your organization, environment and token.');
  }
  if (!res.ok) {
    return buildNotice(res.error ?? 'Failed to query Testkube.');
  }

  const container = document.createElement('div');
  container.appendChild(buildSummary(res.matches));
  if (res.environmentUrl) {
    container.appendChild(buildDashboardLink(res.environmentUrl));
  }
  return container;
}

function buildDashboardLink(environmentUrl: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'tk-gh-dashboard-link';
  link.href = environmentUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Testkube Dashboard';
  return link;
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

function buildSummary(matches: MatchedWorkflow[]): HTMLElement {
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

    const stat = buildStat(kind, items.length, label);
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

function buildStat(kind: StatusKind, count: number, label: string): HTMLElement {
  const stat = document.createElement('span');
  stat.className = 'tk-gh-stat';

  const value = document.createElement('span');
  value.className = 'tk-gh-count';
  value.textContent = String(count);

  const text = document.createElement('span');
  text.textContent = label;

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
function injectIntoSidebar(content: HTMLElement, total: number): boolean {
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
  newHeading.textContent = 'Tests Executed';
  appendHeadingCount(newHeading, total);

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

function injectFloating(content: HTMLElement, total: number): void {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.className = 'tk-gh-floating';

  const heading = document.createElement('span');
  heading.className = 'tk-gh-heading';
  heading.textContent = 'Tests Executed';
  appendHeadingCount(heading, total);

  host.append(heading, content);
  document.body.appendChild(host);
}
