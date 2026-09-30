# Testkube for GitHub (Chrome extension)

A Chrome extension that shows your **Testkube** TestWorkflow results where you work on code, in two
places:

- **Repository pages:** a **"Testkube Results"** section in the repo sidebar for workflows that run tests
  stored in the repository, with their latest status and links to each execution.
- **Pull requests:** for repositories connected through the Testkube GitHub App, the workflows each
  pull request triggered, whichever repository their tests come from, with status, quality gates and
  the AI analysis.

> **Requirements:** a Testkube Control Plane, either Testkube Cloud or an on-prem deployment, and an
> API token for it. The extension uses the Control Plane's organization, environment and GitHub App
> APIs. See [testkube.io/get-started](https://testkube.io/get-started) to get a Control Plane.

## Features

- **"Testkube Results" sidebar section** on the repo home / Code tab, styled to match GitHub's native
  sections (e.g. Releases).
- **Status summary** grouped into passed, failed, aborted, cancelled, and running, each with a hover
  popover listing the matching workflows.
- **Run times**: each status row shows when its most recent run happened (e.g. "Sep 26 2026,
  1:10 PM"), and each workflow in the popovers shows how long ago it last ran.
- **Run history** under each workflow in the popovers: its last 10 executions, oldest to newest, in
  the status colors (green passed, red failed, orange aborted, yellow running); click it to open the
  workflow's executions in Testkube. Popovers list the most recently run workflow first.
- **Deep links into Testkube:**
  - The section title links to the environment's TestWorkflows dashboard.
  - Each status label links to the matching prefiltered executions view (passed / failed / aborted /
    running).
  - Each workflow in a popover links straight to its **most recent execution**.
- **Environment dropdown** — when matching workflows span multiple environments, pick which one to
  view.
- **Refresh** — a refresh icon re-queries on demand, plus an optional auto-refresh interval.
- **GitHub App integration** (when your control plane has the Testkube GitHub App enabled):
  - The sidebar shows whether the repo is **connected** through the GitHub App, with its
    connection status and the last few **pull request runs**. Hovering a PR number shows
    GitHub's own card with the PR title; hovering the pass count (e.g. "3/4 passed") lists the
    tests that ran for it, each linking to its execution. Runs with an AI analysis link straight
    to its chat.
  - Repos that are not connected yet get a link to set that up: **Install Testkube Bot** when the
    Testkube GitHub App is not installed on the repo, or **Connect Testkube Bot** (the dashboard's
    onboarding, with the repo preselected) when it is. If you may install apps on the repo's owner,
    the install link opens the installation for that repository directly; otherwise it opens
    GitHub's account picker.
  - **Pull request pages** get a **Testkube Results** sidebar panel with the latest run for that PR:
    overall status, the head commit it ran for (flagged **stale** when the PR has moved on), one
    row per test workflow execution, quality gates, and a link to the AI analysis chat when one
    was performed.

The organization and the environments your token can access are discovered automatically — you only
provide a token. No Testkube backend changes are required.

## Installation

Install **Testkube for GitHub** from the Chrome Web Store, or load a build unpacked (every
[release](https://github.com/kubeshop/testkube-chrome-extension/releases) has the zip attached):

1. Download or build the extension (see [DEVELOPMENT.md](DEVELOPMENT.md) to build from source).
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dist/` directory.

## Setup

1. Click the extension icon and open **Options** (or right-click the icon → **Options**).
2. Paste your Testkube **API token** (see below).
3. Adjust the **API base URL** / **Dashboard base URL** only if you use an on-prem Control Plane
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

The extension activates automatically on any GitHub repository that a TestWorkflow references (via
its `content.git.uri`) in an environment your token can access — no configuration needed. The
**Testkube Results** section appears in the right-hand sidebar:

- Hover a status row to see the workflows in that bucket.
- Click a workflow to jump to its latest execution in Testkube.
- Click a status label to open the corresponding prefiltered executions list.
- Use the environment dropdown (shown when results span multiple environments) to switch
  environments, and the refresh icon to re-fetch.

By default the section appears on **every** repository. On repos without matching workflows it
shows a short note with links to install the Testkube Bot (or connect the repo, when the bot is
already installed on it) and to open Testkube. Until an API token is set, the section is titled just
**Testkube** and prompts you to set one; pull request pages show nothing until then. Narrow or clear
**Active on repositories** (see below) to show the section only where there are results.

## Configuration

All configuration lives in the options page:

| Setting                | Default                   | Notes                                                                                 |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| API base URL           | `https://api.testkube.io` | Change for on-prem Control Planes                                                     |
| Dashboard base URL     | `https://app.testkube.io` | Used to build deep links                                                              |
| Active on repositories | `*/*` (all repositories)  | Wildcard patterns where the section also shows without results; clear to hide it there |
| Auto-refresh interval  | `0` (off)                 | Seconds between automatic refreshes while viewing a repo                              |
| GitHub App integration | on                        | Query the GitHub App endpoints for connection state and pull request results          |
| API token              | —                         | Stored locally in the browser, never synced                                           |

The section always appears on repos that have a matching workflow or a GitHub App connection.
**Active on repositories** controls where it *also* appears without results, showing the setup and
install prompts. The default `*/*` covers every repository. Enter one wildcard pattern per line,
matched case-insensitively against the full `owner/repo` (e.g. `kubeshop/*`, `*/testkube*`,
`my-org/my-repo`); `*` matches any run of characters and `?` matches a single character. Clearing it
means the extension only appears on repos with results. Settings saved with an earlier version keep
their stored value.

**GitHub App integration** works with any API token that can read an environment. It is checked
per environment, so if the token cannot access the GitHub App endpoints in some environment (for
example on an older control plane), the workflow panel still works there but connection state and
pull request results are skipped. **Test connection** on the options page reports what is
available. Turn the setting off to silence those requests entirely, for example on a control plane
that does not have the GitHub App enabled.

### On-prem Control Planes

Point the **API base URL** (and **Dashboard base URL**) at your on-prem Control Plane. The first time you
**Save** or **Test connection** with a non-default API host, Chrome asks once whether the extension
may access that host; accept the prompt and the grant persists. If you decline, a notice under the
field offers **Grant access** to try again, and the GitHub panel explains what is missing. No
rebuild is needed. For an API served over HTTPS with a self-signed certificate, make sure Chrome
already trusts it (open the API URL in a normal tab once, or install the CA).

## Privacy & security

- Your API token is stored locally in the browser (`chrome.storage.local`) and is never synced or
  sent anywhere except your configured Testkube control plane. Treat it as a credential.
- The extension sends data only to the configured Testkube API host; it does not send data to any
  third party. On github.com it also checks, with your existing GitHub session, whether you may
  install the Testkube Bot on a repository's owner, so the install link can open the right page.
  Only the response status is used.
- Full details in the [privacy policy](PRIVACY.md).

## Limitations

- Workflow matching is repo-level (the GitHub App integration adds PR awareness; branches and
  commits are not covered yet).
- Injects on the repo home / Code tab and on the pull request conversation tab.
- Scans every environment the token can access on each repo page (results cached for a few minutes);
  a large number of environments/workflows increases request fan-out.

## Contributing & development

Build instructions, architecture, and implementation details live in
[DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE)
