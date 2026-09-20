# Development

Implementation, build, and architecture notes for the Testkube GitHub Chrome extension. For
installation and usage, see [README.md](README.md).

## Tech stack

- **Manifest V3** Chrome extension
- **TypeScript** + **React** (options page)
- **Vite** with the **CRXJS** plugin (`@crxjs/vite-plugin`) for the build and dev server

## Prerequisites

- Node.js 20+ and npm
- Google Chrome (or any Chromium-based browser)
- A Testkube Control Plane **API token** with read access to test workflows and executions

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite with the CRXJS plugin and writes an unpacked, hot-reloading extension to
`dist/`.

To load it:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory
4. Open the extension's **Options**, paste your API token, and **Test connection** → **Save**
5. Visit a GitHub repository referenced by a TestWorkflow in any accessible environment

Most source edits hot-reload. Changes to the manifest or service worker may require clicking the
reload icon on the extension card in `chrome://extensions`.

## Build

```bash
npm run build
```

Runs `tsc --noEmit` (type-check) then `vite build`, producing a production bundle in `dist/` that can
be loaded unpacked or zipped for distribution.

### Releasing

CI (`.github/workflows/ci.yml`) type-checks, builds and packages every pull request and push to
`main`. To cut a release:

1. Bump the version in `package.json` (`npm version 1.1.0 --no-git-tag-version`) and merge it.
2. Tag the merge commit with the same version and push the tag:

   ```bash
   git tag v1.1.0 && git push origin v1.1.0
   ```

The release workflow (`.github/workflows/release.yml`) checks that the tag matches
`package.json`, builds, runs `npm run package`, and creates a GitHub Release with the zip attached
and auto-generated notes.

When the Chrome Web Store listing exists, the same workflow can also upload the zip to the store
as a draft (it never publishes). Configure a repository **variable** `CHROME_EXTENSION_ID` (the
listing's id) and the **secrets** `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and
`CHROME_REFRESH_TOKEN`, obtained by following the
[Chrome Web Store API setup](https://developer.chrome.com/docs/webstore/using-api). Until the
variable is set, the upload job is skipped. Publishing stays a manual step in the developer
dashboard, so the listing text and review status can be checked first.

### Packaging for the Chrome Web Store

```bash
npm run package
```

Builds and zips the **contents** of `dist/` (not the folder) into
`testkube-for-github-<version>.zip`, which is what the Web Store developer dashboard accepts. The
zip is produced by [`scripts/package.mjs`](scripts/package.mjs) in pure Node, so it works on any
platform without a `zip` binary.
Bump the version in `package.json` before every upload; the store rejects a re-upload of a version
it has already seen. The listing texts, permission justifications, and asset checklist live in
[STORE_LISTING.md](STORE_LISTING.md); the privacy policy the listing links to is
[PRIVACY.md](PRIVACY.md).

Other scripts:

```bash
npm run typecheck   # type-check only
npm run preview     # preview the built output
```

## How it works

```
GitHub repo page ──(owner/repo)──▶ content script
                                       │ chrome.runtime message
                                       ▼
                              background service worker
                                       │ GET /organizations                         (Bearer token)
                                       │ GET /organizations/{org}/environments
                                       │ GET .../{env}/agent/test-workflows
                                       │ GET .../{name}/executions
                                       ▼
                                api.testkube.io
                                       │
                                       ▼
              injected "Test Results" sidebar section + per-status popovers
                          + environment dropdown with deep links
```

- The **content script** runs on `github.com`, parses `owner/repo` from the URL, and asks the
  background worker for matches. It injects a native-looking "Test Results" section into the repo
  sidebar (above Releases), with the title linking to the dashboard like GitHub's own section
  headers, and re-injects across GitHub's Turbo (soft) navigation. It also shows a loading state on
  first query and drives the optional auto-refresh interval.
- The **background service worker** holds the token and, on each request, discovers the org
  (`GET /organizations` — a token maps to one org) and the environments the token may access
  (`GET /organizations/{org}/environments`). It scans each environment's workflows, matches each
  workflow's `content.git.uri` against the current repo, and fetches the latest execution (status +
  id) for matched workflows. Discovery and per-environment workflow lists are cached for a few
  minutes; manual refresh and auto-refresh bypass the cache.
- The **panel (widget)** groups matches by status (passed, failed, aborted, cancelled, running),
  each with a hover popover listing that status's workflows. An environment dropdown filters to a
  single environment when matches span more than one, and a refresh icon re-queries on demand. When
  there are no matches (but the repo is configured/reachable and allowed by the repo allowlist), it
  renders an empty state encouraging the user to create a Test Workflow, with links to the docs and
  the dashboard.
- The **options page** stores the base URLs, the auto-refresh interval, the repo allowlist, the
  GitHub App toggle, and the API token only.

### GitHub App (Git Integration) support

When the **GitHub App integration** setting is on, the worker also talks to the control plane's
Git Integration endpoints (the ones behind the Testkube GitHub App / "quality loop"):

- On each repo query it **probes every environment** with
  `GET .../integrations/github/integrations`. A `200` means the token can use the GitHub App
  endpoints there and returns the connected repositories; a `403` whose problem `detail` says the
  quality loop feature is not enabled marks the whole control plane as **disabled** (remaining
  environments are skipped); a bare `403` marks that environment **forbidden** (the token cannot
  access the endpoints there, e.g. an older control plane that still required the `run` role); a
  `404` is treated as disabled (older control planes). Results are cached per environment with the usual TTL
  (`githubAppCache` in `chrome.storage.local`).
- The current `owner/repo` is resolved to its numeric GitHub repository id via
  `GET .../integrations/github/repositories?q=owner/repo` through any capable environment
  (cached, including misses). A connection exists when that id appears in an environment's
  integrations list; its first page of
  `GET .../integrations/github/repositories/{repositoryId}/events` yields the recent PR runs.
- Repos that are not connected anywhere get a **connect** link into the dashboard's onboarding
  flow (`/onboarding?ref=github-app-installation&organization_id=…&environment_id=…`), with
  `repository_id=…` appended when an installation already covers the repo. Repos the app is not
  installed on get the same link without it, so the flow can start with installing the app.
- On `/owner/repo/pull/N` the content script sends `GET_PULL_REQUEST`. The worker pages through the
  repo's event log (newest first, bounded) for `pull_request` / `issue_comment` events with that
  `issueNumber`, takes the newest per environment, and reads the head SHA from
  `GET .../executions/{executionId}/integration-events`. The PR panel compares that SHA with the
  PR's current head (the last `/pull/N/commits/<sha>` link in the timeline) and flags stale
  results. The panel is only injected when the repo is connected (or allowlisted).
- Workflows carrying the `testkube.io/managed-by` label (the GitHub App's synthesized
  `ql-parent-*` workflows, test catalog scaffolds) are hidden from the sidebar counts, matching
  what the dashboard shows by default; `ql-parent-*` is also matched by name. The parent
  workflow's execution is never linked either: the PR panel and the recent-PR list only link to
  the child workflow executions, the AI analysis chat, and the repository page. The parent
  execution id is used solely to read the head SHA. Nothing links to the repository's
  integration page in the dashboard either (the extension surfaces results, not integration
  management); the only dashboard entry points are the environment/executions links, the AI
  analysis chat, and the onboarding flow for repos that are not connected yet.

Dashboard deep link added for this: the AI analysis chat `…/dashboard/chats/{sessionId}`.

### Deep links

The dashboard base URL is used to construct links into Testkube:

- **Section title** → environment TestWorkflows list:
  `…/organization/{org}/environment/{env}/dashboard/test-workflows`
- **Status label** → prefiltered executions view, using the dashboard's stable prepopulated view
  IDs: `…/dashboard/executions/views/default-{passed|failed|aborted|running}-executions`. There is
  no prepopulated "cancelled" view, so that label falls back to the unfiltered executions list.
- **Workflow in a popover** → most recent execution details:
  `…/dashboard/executions/{executionId}`. If a workflow has no runs yet, it falls back to the
  workflow's Executions tab: `…/dashboard/test-workflows/{name}/executions`.

## Matching logic

A workflow matches the current repo when any `content.git.uri` found anywhere in its spec (top-level
or in a step) normalizes to the same `github.com/owner/repo` as the page you are on. URL
normalization handles `https://`, `ssh://`, `git@host:owner/repo.git`, and trailing `.git`. See
[`src/lib/match.ts`](src/lib/match.ts).

## Where the extension is active (auto-detection + manual allowlist)

Activity is **hybrid**:

- **Auto-detected**: a repo is active if Testkube has a workflow referencing it. This is learned from
  the same `GET_MATCHES` query the worker already runs (`matches.length > 0`) — the worker fetches
  all workflows for all environments once per TTL and caches them, so the per-repo check is
  cache-backed.
- **Manual**: the optional **Active on repositories** patterns mark additional repos as active even
  when they have no workflow yet (these show the create-a-workflow empty state).

`update()` in [`src/content/content-script.ts`](src/content/content-script.ts) computes
`manual = repoMatchesPatterns(ref, repoFilters)` (an empty list matches nothing). It shows the
loading placeholder only for `manual` repos (known active up front); other repos are queried
silently and only render if the response has matches. After the response it renders when
`hasMatches || manual`, otherwise removes the widget. `repoMatchesPatterns` (in
[`src/lib/match.ts`](src/lib/match.ts)) matches case-insensitively against the full `owner/repo`,
treating `*` as any run of characters and `?` as a single character (all other regex metacharacters
are escaped). Changes to the setting are applied live via the `chrome.storage.onChanged` listener.

Notes:

- This determines whether the panel/queries run, not whether the content script is injected — the
  script still loads on all of `github.com/*` per the static `content_scripts` match in
  `manifest.config.ts`.
- Because auto-detection needs the workflow data to know which repos qualify, the worker is queried
  on every Code-tab repo (served from the shared cache after the first fetch per TTL). Auto-refresh
  only re-queries while a panel is actually showing.

## Caching & refresh

- **Discovery cache** — org + environment list.
- **Workflows cache** — per-environment workflow lists.

Both are keyed by a signature of the API base URL + token and expire after a few minutes
(`CACHE_TTL_MS`). The per-environment scan loads the cache once, mutates it in memory during the
bounded-concurrency scan, and writes it back once to avoid read-modify-write races. Latest execution
status/ids are always fetched fresh. Manual refresh and auto-refresh pass a `force` flag that
bypasses both caches.

## Configuration knobs

Defaults and storage live in [`src/lib/storage.ts`](src/lib/storage.ts):

| Setting                | Default                   | Storage                |
| ---------------------- | ------------------------- | ---------------------- |
| API base URL           | `https://api.testkube.io` | `chrome.storage.sync`  |
| Dashboard base URL     | `https://app.testkube.io` | `chrome.storage.sync`  |
| Active on repositories | `[]` (auto-detect only)   | `chrome.storage.sync`  |
| Auto-refresh interval  | `0` (off)                 | `chrome.storage.sync`  |
| GitHub App integration | `true`                    | `chrome.storage.sync`  |
| API token              | —                         | `chrome.storage.local` |

### Targeting a different control plane

Requests from the service worker and the options page are only exempt from cross-origin rules for
origins the extension holds a host permission for. The manifest grants `https://api.testkube.io/*`
up front and declares `optional_host_permissions` for `https://*/*` and `http://*/*` (optional
patterns do not prompt at install time). When the API base URL points elsewhere, the options page
calls `chrome.permissions.request` for that origin from the **Save** / **Test connection** click
handlers (the call must run from a user gesture, so it happens before any other `await`). The
service worker checks `chrome.permissions.contains` before querying and returns a "grant access"
error instead of a bare fetch failure when the grant is missing. See
[`src/lib/permissions.ts`](src/lib/permissions.ts). The dashboard base URL needs no permission; it
is only used to build links.

## Project layout

```
manifest.config.ts      MV3 manifest (CRXJS)
vite.config.ts          Vite + CRXJS + React
src/
  background/service-worker.ts   message router, REST calls, discovery, caching, deep-link building
  content/content-script.ts      repo / PR detection, injection lifecycle, refresh timer
  content/widget.ts              sidebar section, per-status popovers, env dropdown, GitHub App state
  content/pr-widget.ts           pull request sidebar panel (latest GitHub App run)
  content/widget.css
  options/                       React options page
  lib/
    testkube.ts         REST client (orgs, environments, workflows, executions, GitHub App)
    time.ts             relative-time formatting
    match.ts            URL normalization + repo matching
    permissions.ts      runtime host permission for custom control planes
    storage.ts          settings (sync + local)
    messaging.ts        content <-> background message contract
    log.ts              prefixed logging helpers
    types.ts            minimal API types
```

## Testkube REST API

Endpoints used (all with `Authorization: Bearer <token>`), relative to the API base URL:

- `GET /organizations`
- `GET /organizations/{org}/environments`
- `GET /organizations/{org}/environments/{env}/agent/test-workflows`
- `GET /organizations/{org}/environments/{env}/agent/test-workflows/{name}/executions`

GitHub App integration (only when enabled; the environment `read` role suffices):

- `GET /organizations/{org}/environments/{env}/integrations/github/integrations`
- `GET /organizations/{org}/environments/{env}/integrations/github/repositories?q=owner/repo`
- `GET /organizations/{org}/environments/{env}/integrations/github/repositories/{repositoryId}/events`
- `GET /organizations/{org}/environments/{env}/executions/{executionId}/integration-events`

## Limitations (current scope)

- Workflow matching is repo-level; PR awareness comes from the GitHub App events (no branch /
  commit pages yet).
- Injects on the repo home / Code tab and the PR conversation tab only.
- The events endpoint has no PR-number filter, so the PR lookup pages through the repo's newest
  events (up to 3 pages of 50); a very busy repo could push an old PR past that bound.
- Scans every environment the token can access on each repo page (cached for a few minutes); large
  numbers of environments/workflows increase the request fan-out. A short auto-refresh interval
  re-fetches all environments each tick.
- The API token is stored locally and unencrypted — treat it as a credential.

## License

[MIT](LICENSE)
