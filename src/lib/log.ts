// Lightweight prefixed logging used across all extension contexts.
// Content-script logs appear in the GitHub tab's DevTools console; service-worker
// logs appear in the service worker's own console (chrome://extensions ->
// "Inspect views: service worker").

const PREFIX = '[Testkube]';

export function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
