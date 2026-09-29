// Links for installing the Testkube Bot (the Testkube GitHub App).

// Slug of the Testkube Bot GitHub App (github.com/apps/<slug>). If emptied,
// the install link falls back to the Marketplace listing.
export const TESTKUBE_BOT_APP_SLUG = 'testkubebot';

export const TESTKUBE_BOT_MARKETPLACE_URL = 'https://github.com/marketplace/testkube-bot';

export interface RepoIds {
  // Numeric GitHub id of the repository owner (user or organization).
  ownerId: string;
  // Numeric GitHub id of the repository.
  repositoryId: string;
}

// Read the owner and repository ids GitHub embeds in repository pages
// (octolytics meta tags). Only returned when the tags describe `fullName`, so
// stale tags after a client-side navigation are never used for another repo.
export function readRepoIdsFromPage(doc: Document, fullName: string): RepoIds | undefined {
  const meta = (name: string): string =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? '';
  if (meta('octolytics-dimension-repository_nwo').toLowerCase() !== fullName.toLowerCase()) return undefined;
  const ownerId = meta('octolytics-dimension-user_id');
  const repositoryId = meta('octolytics-dimension-repository_id');
  if (!/^\d+$/.test(ownerId) || !/^\d+$/.test(repositoryId)) return undefined;
  return {ownerId, repositoryId};
}

export interface InstallUrls {
  // Always safe to open: GitHub's account picker (with the repository's owner
  // suggested), or the Marketplace listing while no app slug is set.
  fallback: string;
  // The account-specific installation screen (/installations/new/permissions),
  // which skips the account picker and preselects "Only select repositories"
  // with this repository. GitHub answers 404 there for users who cannot install
  // apps on the account, so only use it after `canOpen` confirms it.
  direct?: string;
}

// Where "Install Testkube Bot" can point. The account id goes in both
// suggested_target_id (required on the direct path) and target_id (what
// GitHub's own install buttons send).
export function testkubeBotInstallUrls(ids?: RepoIds, slug: string = TESTKUBE_BOT_APP_SLUG): InstallUrls {
  if (!slug) return {fallback: TESTKUBE_BOT_MARKETPLACE_URL};
  const base = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  if (!ids) return {fallback: base};
  return {
    fallback: `${base}?suggested_target_id=${ids.ownerId}&repository_ids[]=${ids.repositoryId}`,
    direct:
      `${base}/permissions?suggested_target_id=${ids.ownerId}` +
      `&target_id=${ids.ownerId}&repository_ids[]=${ids.repositoryId}`,
  };
}

// Whether the signed-in GitHub user can open a github.com page: a same-origin
// request carrying their session, true only for a 200. Signed-out users are
// redirected to the login page, which counts as no. Cached per URL for the
// lifetime of the page.
const canOpenCache = new Map<string, Promise<boolean>>();

export function canOpen(url: string): Promise<boolean> {
  let pending = canOpenCache.get(url);
  if (!pending) {
    pending = fetch(url, {method: 'HEAD', credentials: 'include', redirect: 'manual'})
      .then(res => res.status === 200)
      .catch(() => false);
    canOpenCache.set(url, pending);
  }
  return pending;
}
