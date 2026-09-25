# Chrome Web Store listing

Reference material for the Web Store developer dashboard. Keep it in sync with the manifest and
[PRIVACY.md](PRIVACY.md).

## Product details

- **Name:** Testkube for GitHub
- **Summary** (from the manifest, max 132 chars): Surfaces Testkube TestWorkflow Results on GitHub repos and Pull Requests. Requires a Testkube Control Plane (Cloud or on-prem).
- **Category:** Developer Tools
- **Language:** English
- **Homepage / support:** <https://github.com/kubeshop/testkube-chrome-extension>
- **Privacy policy URL:**
  <https://github.com/kubeshop/testkube-chrome-extension/blob/main/PRIVACY.md>

## Detailed description

Testkube for GitHub brings your Testkube test results to the place you review code.

Requirements: a Testkube Control Plane, either Testkube Cloud or an on-prem deployment, and an API
token for it. The extension does not work with Testkube Open Source (the standalone agent), which
does not provide the Control Plane APIs it uses. See https://testkube.io/get-started to get a Control
Plane.

On any GitHub repository that a Testkube TestWorkflow tests, a **Test Results** section appears in
the repository sidebar: how many workflows ran, their latest status (passed, failed, aborted,
cancelled, running), and deep links into the Testkube dashboard. Hover a status to see the
workflows behind it and jump straight to their most recent execution.

If the repository is connected through the **Testkube GitHub App**, the sidebar also shows the
connection status and recent pull request runs, and the **pull request conversation tab** gets a
Testkube panel with the latest run for that PR: overall status, the commit it ran for (flagged when
the PR has moved on), one row per workflow execution, quality gates, and a link to the AI analysis
when one was performed. Repositories that are not connected yet get a one-click link to connect
them. The GitHub App features require the Testkube GitHub App to be enabled on your control plane
and an API token with access to its integration endpoints; otherwise the extension shows workflow
results only.

Setup takes a minute: paste a Testkube API token in the options page. The extension discovers your
organization and environments automatically. It works with Testkube Cloud out of the box and with
on-prem Control Planes by entering your own API and dashboard URLs.

Features

- Test Results sidebar section on repository pages, styled like GitHub's own sections
- Per-status hover popovers with links to the latest execution of each workflow
- Environment switcher when results span several Testkube environments
- Pull request panel with the latest GitHub App run, child executions, and quality gates
- Recent pull request runs on the repository page
- Manual refresh and optional auto-refresh
- Works with the Testkube Control Plane, Cloud or on-prem

Privacy

The extension talks only to the Testkube control plane you configure. Your API token stays in your
browser. No analytics, no third parties.

## Single purpose

Show Testkube test results on GitHub repository and pull request pages.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's Testkube API token and settings, and caches control-plane responses for a few minutes. |
| Host `https://api.testkube.io/*` | Calls the Testkube Cloud API to read organizations, environments, test workflows, executions, and GitHub App integration state for the repository or pull request being viewed. |
| Content script on `https://github.com/*` | Reads the repository name and pull request number from the page URL (and the PR's head commit from the page) to select which results to show, and injects the Test Results section into the sidebar. Only the repository name is sent to the configured Testkube host. |
| Optional hosts `https://*/*`, `http://*/*` | Users running an on-prem Testkube Control Plane enter their own API URL. Access to that single origin is requested at runtime, only when the user saves such a URL, and is used solely for the same Testkube API calls. No host is accessed without an explicit grant. |

## Data usage disclosure

- **Data collected:** Authentication information (the user's Testkube API token, entered by the
  user). Website content: the repository name (`owner/repo`) of the GitHub page being viewed, sent
  to the user's Testkube control plane as a query parameter. The pull request number is used only
  locally to select results.
- **Not collected:** personal communications, financial or payment information, health
  information, location, web history, user activity, personally identifiable information.
- **Certifications:** data is not sold to third parties; not used or transferred for purposes
  unrelated to the item's core functionality; not used or transferred to determine
  creditworthiness or for lending purposes.
- **Remote code:** none. All code ships in the package.

## Assets checklist

- [x] Icon 128×128 PNG (`public/icons/icon128.png`)
- [ ] Screenshots, 1280×800 or 640×400 PNG/JPEG, at least one, no padding or rounded corners:
  - repository sidebar with results and a hover popover
  - pull request page with the Testkube panel
  - options page
- [ ] Small promo tile 440×280 (needed only for featuring)
- [ ] Zip produced by `npm run package`

## Submission steps

1. Bump the version in `package.json` (the store rejects a version it has already seen).
2. `npm run package` and upload `testkube-for-github-<version>.zip` in the developer dashboard.
3. Fill in the store listing, privacy, and distribution tabs from the sections above.
4. Consider an **unlisted** first release so the team can install from the store link before the
   listing goes public.
