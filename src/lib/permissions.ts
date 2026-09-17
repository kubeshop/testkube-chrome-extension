// Runtime host permissions for custom control planes.
//
// The manifest grants access to the Testkube Cloud API up front. Any other API
// base URL (a self-managed control plane) is covered by the broad
// `optional_host_permissions` patterns and has to be granted by the user at
// runtime, otherwise the browser blocks the requests as cross-origin.

export const DEFAULT_API_ORIGIN = 'https://api.testkube.io';

// Match pattern covering the origin of an API base URL, e.g.
// `https://testkube.example.com/*`. Null when the URL is not a valid http(s) URL.
export function hostPatternFor(apiBaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(apiBaseUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.protocol}//${url.host}/*`;
}

// Whether the URL points at the cloud control plane the manifest already allows.
export function isDefaultApiHost(apiBaseUrl: string): boolean {
  try {
    return new URL(apiBaseUrl.trim()).origin === DEFAULT_API_ORIGIN;
  } catch {
    return false;
  }
}

export async function hasHostPermission(apiBaseUrl: string): Promise<boolean> {
  const pattern = hostPatternFor(apiBaseUrl);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

// Ask the user to allow the host. Must be called from a user gesture (a click
// handler); resolves false when the user declines or the URL is invalid.
export async function requestHostPermission(apiBaseUrl: string): Promise<boolean> {
  const pattern = hostPatternFor(apiBaseUrl);
  if (!pattern) return false;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}
