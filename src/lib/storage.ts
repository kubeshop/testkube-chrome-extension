import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: 'https://api.testkube.io',
  dashboardBaseUrl: 'https://app.testkube.io',
  orgId: '',
  environmentId: '',
  apiToken: '',
};

// Non-secret settings live in storage.sync; the API token lives in storage.local
// so it is not synced across the user's browsers.
const SYNC_KEYS = ['apiBaseUrl', 'dashboardBaseUrl', 'orgId', 'environmentId'] as const;
const TOKEN_KEY = 'apiToken';

export async function getSettings(): Promise<Settings> {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEYS as unknown as string[]),
    chrome.storage.local.get(TOKEN_KEY),
  ]);
  return {
    ...DEFAULT_SETTINGS,
    ...sync,
    apiToken: (local[TOKEN_KEY] as string) ?? '',
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await Promise.all([
    chrome.storage.sync.set({
      apiBaseUrl: s.apiBaseUrl.trim(),
      dashboardBaseUrl: s.dashboardBaseUrl.trim(),
      orgId: s.orgId.trim(),
      environmentId: s.environmentId.trim(),
    }),
    chrome.storage.local.set({ [TOKEN_KEY]: s.apiToken.trim() }),
  ]);
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.apiBaseUrl && s.orgId && s.environmentId && s.apiToken);
}
