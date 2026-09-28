// Links for installing the Testkube Bot (the Testkube GitHub App).

// Slug of the Testkube Bot GitHub App (github.com/apps/<slug>). If emptied,
// the install link falls back to the Marketplace listing.
export const TESTKUBE_BOT_APP_SLUG = 'testkube-bot';

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

// Where "Install Testkube Bot" points: straight to the app's installation page,
// preselecting the repository's owner and the repository itself when their ids
// are known, or the Marketplace listing while the app slug is not set.
export function testkubeBotInstallUrl(ids?: RepoIds, slug: string = TESTKUBE_BOT_APP_SLUG): string {
  if (!slug) return TESTKUBE_BOT_MARKETPLACE_URL;
  const base = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  if (!ids) return base;
  return `${base}?suggested_target_id=${ids.ownerId}&repository_ids[]=${ids.repositoryId}`;
}
