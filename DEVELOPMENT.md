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
  single environment when matches span more than one, and a refresh icon re-queries on demand.
- The **options page** stores the base URLs, the auto-refresh interval, and the API token only.

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

| Setting               | Default                   | Storage                |
| --------------------- | ------------------------- | ---------------------- |
| API base URL          | `https://api.testkube.io` | `chrome.storage.sync`  |
| Dashboard base URL    | `https://app.testkube.io` | `chrome.storage.sync`  |
| Auto-refresh interval | `0` (off)                 | `chrome.storage.sync`  |
| API token             | —                         | `chrome.storage.local` |

### Targeting a different control plane

If you point the API base URL at a different host, add that origin to `host_permissions` in
[`manifest.config.ts`](manifest.config.ts) and rebuild — otherwise the background worker's requests
will be blocked by the browser.

## Project layout

```
manifest.config.ts      MV3 manifest (CRXJS)
vite.config.ts          Vite + CRXJS + React
src/
  background/service-worker.ts   message router, REST calls, discovery, caching, deep-link building
  content/content-script.ts      repo detection, injection lifecycle, refresh timer
  content/widget.ts              sidebar section, per-status popovers, env dropdown, loading state
  content/widget.css
  options/                       React options page
  lib/
    testkube.ts         REST client (orgs, environments, workflows, executions)
    match.ts            URL normalization + repo matching
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

## Limitations (current scope)

- Repo-level matching only (no branch / PR / path awareness yet).
- Injects only on the repo home / Code tab.
- Scans every environment the token can access on each repo page (cached for a few minutes); large
  numbers of environments/workflows increase the request fan-out. A short auto-refresh interval
  re-fetches all environments each tick.
- The API token is stored locally and unencrypted — treat it as a credential.

## License

[MIT](LICENSE)
