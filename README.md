# Testkube for GitHub (Chrome extension)

A Chrome extension that surfaces your **Testkube** test results directly on GitHub repository pages.
When you open a repo that is referenced by one or more Testkube TestWorkflows, the extension adds a
**"Test Results"** section to the repo sidebar showing how many workflows ran, their latest status,
and deep links into the Testkube dashboard.

## Features

- **"Test Results" sidebar section** on the repo home / Code tab, styled to match GitHub's native
  sections (e.g. Releases).
- **Status summary** grouped into passed, failed, aborted, cancelled, and running, each with a hover
  popover listing the matching workflows.
- **Deep links into Testkube:**
  - The section title links to the environment's TestWorkflows dashboard.
  - Each status label links to the matching prefiltered executions view (passed / failed / aborted /
    running).
  - Each workflow in a popover links straight to its **most recent execution**.
- **Environment dropdown** — when matching workflows span multiple environments, pick which one to
  view.
- **Refresh** — a refresh icon re-queries on demand, plus an optional auto-refresh interval.

The organization and the environments your token can access are discovered automatically — you only
provide a token. No Testkube backend changes are required.

## Installation

> This extension is not yet published to the Chrome Web Store. Install it unpacked from a build.

1. Download or build the extension (see [DEVELOPMENT.md](DEVELOPMENT.md) to build from source).
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dist/` directory.

## Setup

1. Click the extension icon and open **Options** (or right-click the icon → **Options**).
2. Paste your Testkube **API token** (see below).
3. Adjust the **API base URL** / **Dashboard base URL** only if you use a self-managed control plane
   (defaults target Testkube Cloud).
4. Optionally set an **auto-refresh interval** (seconds; `0` disables it).
5. Click **Test connection** to verify — it reports the resolved organization and the number of
   accessible environments — then **Save**.

### Getting an API token

Create an API token/key from your Testkube account or organization settings with read access to test
workflows and executions, and paste it into the options page. A token is tied to a single
organization; the extension resolves that organization and the environments the token may access
automatically, so no IDs are required.

## Usage

Visit any GitHub repository that is referenced by a TestWorkflow (via its `content.git.uri`) in an
environment your token can access. The **Test Results** section appears in the right-hand sidebar:

- Hover a status row to see the workflows in that bucket.
- Click a workflow to jump to its latest execution in Testkube.
- Click a status label to open the corresponding prefiltered executions list.
- Use the environment dropdown (shown when results span multiple environments) to switch
  environments, and the refresh icon to re-fetch.

If no workflows reference the repo, the section is not shown.

## Configuration

All configuration lives in the options page:

| Setting               | Default                   | Notes                                                    |
| --------------------- | ------------------------- | -------------------------------------------------------- |
| API base URL          | `https://api.testkube.io` | Change for self-managed control planes                   |
| Dashboard base URL    | `https://app.testkube.io` | Used to build deep links                                 |
| Auto-refresh interval | `0` (off)                 | Seconds between automatic refreshes while viewing a repo |
| API token             | —                         | Stored locally in the browser, never synced              |

If you point the API base URL at a different host, that origin must also be allowed in the
extension's host permissions — see [DEVELOPMENT.md](DEVELOPMENT.md).

## Privacy & security

- Your API token is stored locally in the browser (`chrome.storage.local`) and is never synced or
  sent anywhere except your configured Testkube control plane. Treat it as a credential.
- The extension only makes requests to the configured Testkube API host; it does not send data to
  any third party.

## Limitations

- Repo-level matching only (no branch / PR / path awareness yet).
- Injects only on the repo home / Code tab.
- Scans every environment the token can access on each repo page (results cached for a few minutes);
  a large number of environments/workflows increases request fan-out.

## Contributing & development

Build instructions, architecture, and implementation details live in
[DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE)
