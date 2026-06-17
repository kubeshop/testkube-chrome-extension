# Testkube for GitHub (Chrome extension)

A proof-of-concept Manifest V3 Chrome extension that injects a **"Testkube"** badge into the
GitHub repository page. The badge shows how many Testkube TestWorkflows reference the repository
you are viewing, their latest run status, and deep links into the Testkube dashboard.

It talks to the Testkube Control Plane REST API (`https://api.testkube.io` by default) using an API
token you provide in the options page. No backend changes are required.

## How it works

```
GitHub repo page ──(owner/repo)──▶ content script
                                       │ chrome.runtime message
                                       ▼
                              background service worker
                                       │ GET /agent/test-workflows  (Bearer token)
                                       │ GET .../{name}/executions
                                       ▼
                                api.testkube.io
                                       │
                                       ▼
                injected Shadow-DOM badge + popover with deep links
```

- The **content script** runs on `github.com`, parses `owner/repo`, and asks the background worker
  for matches. It injects a badge into the repo "About" sidebar and re-injects across GitHub's
  Turbo (soft) navigation.
- The **background service worker** holds the token, calls the REST API (avoiding content-script
  CORS), matches each workflow's `spec.content.git.uri` against the current repo, and fetches the
  latest execution status for matched workflows. Workflow lists are cached per environment for a
  few minutes.
- The **options page** stores your organization ID, environment ID, base URLs, and API token.

## Prerequisites

- Node.js 20+ and npm
- Google Chrome (or any Chromium-based browser)
- A Testkube Control Plane account with:
  - an **Organization ID** and **Environment ID**
  - an **API token / key** with read access to test workflows and executions

### Finding your org/environment IDs and token

The IDs appear in the dashboard URL when you are inside an environment:

```
https://app.testkube.io/organization/<ORG_ID>/environment/<ENV_ID>/dashboard/...
```

Create an API token from your Testkube account/organization settings and paste it into the options
page.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite with the CRXJS plugin and writes an unpacked extension to `dist/` with
hot reloading.

To load it:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory
4. Open the extension's **Options** and fill in API base URL, org ID, environment ID, and token
5. Click **Test connection** to verify, then **Save**
6. Visit a GitHub repository that is referenced by a TestWorkflow in that environment

## Build

```bash
npm run build
```

Produces a production bundle in `dist/` that can be loaded unpacked or zipped for distribution.

## Configuration

All configuration lives in the options page:

| Setting            | Default                   | Notes                                              |
| ------------------ | ------------------------- | -------------------------------------------------- |
| API base URL       | `https://api.testkube.io` | Change for self-managed control planes (see below) |
| Dashboard base URL | `https://app.testkube.io` | Used to build deep links                           |
| Organization ID    | —                         | From the dashboard URL                             |
| Environment ID     | —                         | From the dashboard URL                             |
| API token          | —                         | Stored in `chrome.storage.local`, never synced     |

If you point the API base URL at a different host, you must also add that origin to
`host_permissions` in [`manifest.config.ts`](manifest.config.ts) and rebuild, otherwise the
background worker's requests will be blocked.

## Matching logic

A workflow matches the current repo when any `content.git.uri` found anywhere in its spec
(top-level or in a step) normalizes to the same `github.com/owner/repo` as the page you are on.
URL normalization handles `https://`, `ssh://`, `git@host:owner/repo.git`, and trailing `.git`.

## Limitations (PoC scope)

- Repo-level matching only (no branch/PR/path awareness yet)
- Single organization/environment configured manually
- The API token is stored locally and unencrypted — treat it as a credential
- Status lookups are capped per page to avoid request bursts
- Injects only on the repo home / Code tab

## Project layout

```
manifest.config.ts      MV3 manifest (CRXJS)
vite.config.ts          Vite + CRXJS + React
src/
  background/service-worker.ts   message router, REST calls, caching
  content/content-script.ts      repo detection + injection lifecycle
  content/widget.ts              Shadow-DOM badge + popover
  content/widget.css
  options/              React options page
  lib/
    testkube.ts         REST client
    match.ts            URL normalization + matching
    storage.ts          settings (sync + local)
    messaging.ts        content <-> background message contract
    types.ts            minimal API types
```
