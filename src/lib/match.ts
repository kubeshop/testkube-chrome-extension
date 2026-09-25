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

// Whether the repo explicitly matches one of the user's wildcard patterns,
// compared case-insensitively against the full "owner/repo" string. An empty
// list matches nothing (activity then comes purely from Testkube auto-detection).
export function repoMatchesPatterns(ref: RepoRef, patterns: string[]): boolean {
  const cleaned = patterns.map(p => p.trim()).filter(Boolean);
  if (cleaned.length === 0) return false;
  const target = `${ref.owner}/${ref.repo}`;
  return cleaned.some(p => wildcardToRegExp(p).test(target));
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
  return {host: 'github.com', owner, repo: stripGitSuffix(parts[1])};
}

function refFromHostPath(host: string, path: string): RepoRef | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return {host: host.toLowerCase(), owner: parts[0], repo: stripGitSuffix(parts[1])};
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

// A single `content.git` block from a workflow.
export interface GitContent {
  uri: string;
  revision?: string;
  paths: string[];
}

// A git path matched to the current repo, kept with the revision of the block
// it came from so we can build accurate GitHub links.
export interface MatchedGitPath {
  path: string;
  revision?: string;
}

// Recursively collect every `content.git` block found anywhere in a workflow
// object (top-level spec.content.git plus any nested step content).
export function extractGitContents(workflow: unknown): GitContent[] {
  const contents: GitContent[] = [];

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
      if (uri) {
        const revision = typeof git.revision === 'string' && git.revision.trim() ? git.revision.trim() : undefined;
        const paths = Array.isArray(git.paths)
          ? git.paths
              .filter((p): p is string => typeof p === 'string')
              .map(p => p.trim())
              .filter(Boolean)
          : [];
        contents.push({uri, revision, paths});
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };

  visit(workflow);
  return contents;
}

// Backwards-compatible helper: just the unique git URIs.
export function extractGitUris(workflow: unknown): string[] {
  const seen = new Set<string>();
  const uris: string[] = [];
  for (const {uri} of extractGitContents(workflow)) {
    if (!seen.has(uri)) {
      seen.add(uri);
      uris.push(uri);
    }
  }
  return uris;
}

// Glob metacharacters that make a path segment non-navigable on GitHub.
const GLOB_CHARS = /[*?[\]{}!]/;

// Returns the leading run of path segments that contain no glob metacharacters,
// i.e. the nearest non-glob directory the path can be linked to. For a fully
// concrete path this is the path itself; for `tests/**/*.spec.ts` it is `tests`;
// for `**/foo` it is the empty string (link to the repo root).
export function nearestNonGlobDir(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const prefix: string[] = [];
  for (const segment of segments) {
    if (GLOB_CHARS.test(segment)) break;
    prefix.push(segment);
  }
  return prefix.join('/');
}

export function workflowMatchesRepo(
  workflow: unknown,
  repo: RepoRef
): {matches: boolean; gitUris: string[]; paths: MatchedGitPath[]} {
  const target = canonicalRepoKey(repo);
  const matching = extractGitContents(workflow).filter(content => {
    const ref = normalizeGitUri(content.uri);
    return ref ? canonicalRepoKey(ref) === target : false;
  });

  const seenUris = new Set<string>();
  const gitUris: string[] = [];
  const seenPaths = new Set<string>();
  const paths: MatchedGitPath[] = [];

  for (const content of matching) {
    if (!seenUris.has(content.uri)) {
      seenUris.add(content.uri);
      gitUris.push(content.uri);
    }
    for (const path of content.paths) {
      const key = `${content.revision ?? ''}\u0000${path}`;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        paths.push({path, revision: content.revision});
      }
    }
  }

  return {matches: matching.length > 0, gitUris, paths};
}
