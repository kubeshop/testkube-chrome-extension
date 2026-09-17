# Privacy Policy — Testkube for GitHub

_Last updated: 2026-09-17_

**Testkube for GitHub** is a browser extension that shows Testkube test results on GitHub
repository and pull request pages. This policy describes what data the extension handles and
where it goes.

## What the extension stores

- **Testkube API token** — entered by you in the extension's options page. Stored in the
  browser's local extension storage (`chrome.storage.local`) on the device where you entered it.
  It is never synced to other devices or accounts.
- **Settings** — the API and dashboard base URLs, the auto-refresh interval, the repository
  patterns, and the GitHub App toggle. Stored in the browser's synced extension storage
  (`chrome.storage.sync`), which Chrome may sync across your signed-in browsers.
- **Cached responses** — organization, environment, workflow, and GitHub App connection data
  returned by your Testkube control plane, kept in local extension storage for a few minutes to
  reduce repeated requests.

## What the extension sends, and to whom

- The extension sends requests **only to the Testkube control plane you configure** (by default
  `https://api.testkube.io`). Each request carries your API token so Testkube can authorize it.
- The requests include the GitHub repository name (`owner/repo`) and, on pull request pages, the
  pull request number of the page you are viewing, so Testkube can return the matching results.
- The extension **does not send any data to the extension's authors or to any third party**. It
  contains no analytics, telemetry, advertising, or tracking.

## What the extension reads from GitHub pages

The extension runs on `github.com` pages to read the repository name and pull request number from
the page URL, and the pull request's current head commit from the page, in order to look up and
display matching results. It does not read or transmit any other page content, and it does not
access your GitHub account or credentials.

## Optional host access

If you configure a self-managed Testkube control plane, Chrome asks once whether the extension may
access that host. The grant is used solely to send the requests described above to that host.

## Data retention and deletion

All data lives in your browser. Removing the extension deletes its storage. You can also clear the
API token at any time from the options page.

## Contact

Questions about this policy: open an issue at
<https://github.com/kubeshop/testkube-chrome-extension/issues>.
