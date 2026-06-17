export interface RepoRef {
  host: string; // e.g. 'github.com'
  owner: string;
  repo: string;
}

export function canonicalRepoKey(ref: RepoRef): string {
  return `${ref.host}/${ref.owner}/${ref.repo}`.toLowerCase();
}

function stripGitSuffix(s: string): string {
  return s.replace(/\.git$/i, '');
}

// Convert a wildcard pattern (`*` = any run of chars, `?` = single char) into a
// case-insensitive, fully-anchored RegExp. All other regex metacharacters are
// escaped so patterns behave like globs, not regexes.
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

// Whether the repo is allowed by the user's allowlist of wildcard patterns,
// matched case-insensitively against the full "owner/repo" string. An empty
// list means "active on all repos".
export function repoMatchesFilters(ref: RepoRef, filters: string[]): boolean {
  const patterns = filters.map((f) => f.trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  const target = `${ref.owner}/${ref.repo}`;
  return patterns.some((p) => wildcardToRegExp(p).test(target));
}

// GitHub top-level path segments that are not repository owners.
const RESERVED_OWNERS = new Set([
  'orgs',
  'organizations',
  'settings',
  'notifications',
  'marketplace',
  'explore',
  'topics',
  'collections',
  'trending',
  'events',
  'sponsors',
  'apps',
  'features',
  'about',
  'pricing',
  'login',
  'logout',
  'join',
  'new',
  'codespaces',
  'dashboard',
  'pulls',
  'issues',
  'search',
  'account',
]);

// Parse owner/repo from a github.com pathname like /owner/repo or /owner/repo/tree/main.
export function parseGithubRepoFromPath(pathname: string): RepoRef | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { host: 'github.com', owner, repo: stripGitSuffix(parts[1]) };
}

function refFromHostPath(host: string, path: string): RepoRef | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { host: host.toLowerCase(), owner: parts[0], repo: stripGitSuffix(parts[1]) };
}

// Normalize a git remote URI to host/owner/repo, handling scp-like, ssh://,
// https:// and git:// forms. Returns null if it cannot be parsed.
export function normalizeGitUri(uri: string): RepoRef | null {
  if (!uri) return null;
  let s = uri.trim();

  // scp-like syntax: git@github.com:owner/repo.git
  const scp = /^[a-zA-Z0-9._-]+@([^/:]+):(.+)$/.exec(s);
  if (scp) {
    return refFromHostPath(scp[1], scp[2]);
  }

  s = s.replace(/^git\+/, '');
  try {
    const u = new URL(s);
    return refFromHostPath(u.hostname, u.pathname);
  } catch {
    return null;
  }
}

// Recursively collect every content.git.uri found anywhere in a workflow object
// (top-level spec.content.git plus any nested step content).
export function extractGitUris(workflow: unknown): string[] {
  const uris: string[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    const git = obj.git as Record<string, unknown> | undefined;
    if (git && typeof git === 'object' && typeof git.uri === 'string') {
      const uri = git.uri.trim();
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        uris.push(uri);
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };

  visit(workflow);
  return uris;
}

export function workflowMatchesRepo(
  workflow: unknown,
  repo: RepoRef,
): { matches: boolean; gitUris: string[] } {
  const target = canonicalRepoKey(repo);
  const matchingUris = extractGitUris(workflow).filter((uri) => {
    const ref = normalizeGitUri(uri);
    return ref ? canonicalRepoKey(ref) === target : false;
  });
  return { matches: matchingUris.length > 0, gitUris: matchingUris };
}
