# Changelog

All notable user-facing changes to **Testkube for GitHub**. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions match the extension version
in the Chrome Web Store.

## [Unreleased]

## [1.0.1] - 2026-09-30

### Added

- The Testkube section now appears on every repository after installation: **Active on
  repositories** defaults to `*/*`. Repositories without results show setup and connection
  prompts; narrow or clear the setting to show the section only where there are results.
- **Install Testkube Bot** link for repositories the Testkube GitHub App is not installed on. It
  opens the installation for that repository directly when you may install apps on its owner, and
  GitHub's account picker otherwise. Repositories the app is already installed on get **Connect
  Testkube Bot** instead.
- Run times: each status row shows when its most recent run happened, and each workflow in the
  status popovers shows how long ago it last ran.
- Run history: each workflow in the status popovers shows its last 10 runs, oldest to newest;
  click it to open the workflow's executions in Testkube.
- The pull request panel and the recent pull request list show when each test execution ran.
- Running workflows have an animated status icon, like the executions view in the Testkube
  dashboard. It stays still when the system asks for reduced motion.

### Changed

- The section is titled **Testkube** until an API token is configured, and **Testkube Results**
  afterwards.
- Pull request pages show no panel until an API token is configured.
- The status popovers list the most recently run workflows first.
- A run's status stays readable without hovering: screen readers always get it, and it is shown
  next to the time when the icon alone is ambiguous (e.g. running).
- On pull request pages the extension sends the pull request number to your Testkube Control
  Plane, so it can return just that pull request's runs. The privacy policy has the details.

### Fixed

- The pull request panel no longer misses runs on busy repositories. It asks the Control Plane
  for the pull request's events only (on Control Planes that support it) and otherwise searches
  much further back through the repository's events.
- The aborted, cancelled and running status icons were drawn smaller than the passed and failed
  icons.

## [1.0.0] - 2026-09-25

First release.

- A **Test Results** section in the sidebar of repositories whose tests Testkube TestWorkflows
  run, with the latest status per workflow, hover popovers and deep links into the Testkube
  dashboard.
- Testkube GitHub App integration: connection state and recent pull request runs on repository
  pages, and a panel with the latest run on pull request pages.
- Works with Testkube Cloud and on-prem Control Planes; host access for custom API URLs is
  requested at runtime.

[Unreleased]: https://github.com/kubeshop/testkube-chrome-extension/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/kubeshop/testkube-chrome-extension/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/kubeshop/testkube-chrome-extension/releases/tag/v1.0.0
