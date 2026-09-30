# AGENTS.md

Guidelines for AI agents and contributors working on **Testkube for GitHub**, a Chrome (MV3)
extension that shows Testkube TestWorkflow results on GitHub repository and pull request pages.
Architecture and implementation details live in [DEVELOPMENT.md](DEVELOPMENT.md); read it before
changing behavior.

This repository is **public**. Everything in it (code, comments, docs, commit messages, pull request
titles and descriptions) is visible to anyone. See [Public repository hygiene](#public-repository-hygiene).

## Keep the docs in sync (every change)

Every change that affects what users see or what the extension does must update the documentation
**in the same pull request**. Before opening or updating a PR, go through this list:

| Document | Update when |
| --- | --- |
| [README.md](README.md) | Features, UI text, defaults, settings, requirements, install or setup steps change. Keep the Features list, Usage, the Configuration table and Privacy & security accurate. |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture, request flow, endpoints used, caching, deep links, message contract, project layout (new files in `src/`), scripts or tooling change. |
| [STORE_LISTING.md](STORE_LISTING.md) | The store description, features, permission justifications or data usage disclosure change. Say in the PR that the Web Store dashboard needs the same update with the next upload. |
| [CHANGELOG.md](CHANGELOG.md) | **Any user-facing change.** Add a line under `## [Unreleased]` (Added / Changed / Fixed), written for users, not developers. Docs-only and tooling changes need no entry. |
| [PRIVACY.md](PRIVACY.md) | **Anything the extension reads, stores or sends changes**, including new requests to any host (github.com included). Update the "Last updated" date. It is the public privacy policy linked from the store. |
| `manifest.config.ts` `description` | The one-line summary changes. It is also the store summary: at most 132 characters, shown verbatim. |
| Options page hint texts (`src/options/App.tsx`) | A setting's meaning or default changes. |

Also:

- Before finishing, search the docs for wording the change made stale (old titles, removed links,
  old defaults) and fix every hit, not only the paragraph you started from.
- After a release, check the docs against everything merged since the previous tag
  (`git log --oneline vX.Y.Z..HEAD`).
- The store renders the detailed description as **plain text**: no markdown emphasis in that
  section of STORE_LISTING.md.

## Public repository hygiene

Never put these in the repository, commit messages, or PR titles and descriptions:

- References to private Kubeshop repositories, their internal paths, file names or commit hashes.
  Describe shared configuration generically ("the shared configuration used by Testkube's frontend
  projects").
- Internal code names. The only exception is a literal the code must match, such as an API error
  text; name the surrounding constant neutrally.
- How the Testkube GitHub App orchestrates a run internally. Describe a pull request run only in
  terms of its **test executions** or **test workflows**, and do not name, link to or describe any
  internal workflow or execution behind it. The control plane already leaves system-managed
  workflows out of the list the extension uses; do not add client-side logic that names them.
- Secrets, tokens, or real customer data in examples.

Git history and PR edit histories are public too: get the wording right before pushing.

## Wording

| Use | Avoid |
| --- | --- |
| Testkube Control Plane (Cloud or on-prem) | "self-managed control plane", "commercial" |
| on-prem | self-hosted, self-managed |
| Testkube Bot (the Testkube GitHub App) | internal app names |
| **Install Testkube Bot** (app not installed on the repo) / **Connect Testkube Bot** (installed, repo not connected) | showing both at once |
| workflows that **run tests stored in** a repository, or are **triggered by** its pull requests | workflows that "test" a repository |
| test executions / test workflows of a run | internal orchestration terms |
| https://testkube.io/get-started for "get a Control Plane" links | pricing links |

- Do not mention Testkube Open Source in user-facing text. The one exception is the error shown when
  the API URL does not answer like a Control Plane.
- The panels are titled **Testkube** until an API token is configured, then **Testkube Results**.

## UI rules

- The extension surfaces results; it does not manage integrations. Do not link to the repository
  integration or settings pages in the dashboard, or to the GitHub App's internal executions.
  Allowed dashboard entry points: environment and executions views, individual executions, a
  workflow's executions list, the AI analysis chat, and onboarding for repos that are not connected.
- The pull request panel shows nothing until an API token is configured; the repository sidebar
  carries the setup notice.
- Status colors are shared by icons and run history: green passed, red failed, orange aborted,
  yellow running, grey otherwise. Keep icon sizes consistent (full 16px discs). In-progress runs use
  a spinning ring, like the dashboard's running icon, and stay still under reduced motion.
- Popover lists are ordered most recently run first.
- The Install Testkube Bot link must never lead to a 404: use the direct installation URL only after
  the permission check succeeds (see DEVELOPMENT.md).
- When the user provides a mockup, match it and verify the result visually before reporting done.

## Behavior and data

- The extension only uses existing Control Plane endpoints; the environment **read** role is
  enough. Handle 403/404 from optional endpoints by degrading gracefully, never by erroring out.
- Send data only to the configured Control Plane. The only other request allowed is the
  same-origin, status-only install-permission check on github.com. No analytics or telemetry.
- Settings are in `chrome.storage.sync` (token in `chrome.storage.local`); defaults only apply to
  keys a user never saved. Any settings change must refresh open GitHub tabs.
- Keep API usage lean: prefer widening an existing request (e.g. `pageSize`) over adding requests,
  and cache per the existing TTL.

## Development checks

Run before every push; CI runs the same on every PR and push to `main`:

```bash
npm run format        # then commit the result
npm run lint
npm run format:check
npm run typecheck
npm run package       # type-check, build and zip
```

- `config/eslint.shared.js` and `config/prettier.shared.cjs` are verbatim copies of the shared
  Testkube rules. Do not edit them; put overrides in the root `eslint.config.js`.
- `.npmrc` sets `legacy-peer-deps` on purpose (ESLint 10 with plugins that declare ESLint 9).
- The build uses a platform-specific native binding: on Apple Silicon use an arm64 Node.
- There are no automated tests yet. Check pure logic in `src/lib` with a quick script, and say in
  the PR what was and was not verified.

## Git and pull requests

- One focused PR per request, branched from the latest `origin/main`. Conventional Commits for
  commit messages and PR titles (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `style:`).
- `git checkout -b <branch> origin/main` makes the branch **track `main`**, and a later plain
  `git push` is then rejected. Run `git branch --unset-upstream` after creating the branch and push
  with an explicit target: `git push -u origin HEAD:<branch>`.
- After every push, verify the remote has the commit (`git rev-parse HEAD` equals
  `git rev-parse origin/<branch>` after a fetch) and that the PR lists it. Never report work as
  pushed or merged without checking.
- When adding commits to an open PR, update its title and description to match.
- Review comments (e.g. Greptile): assess each finding against the code, fix valid ones, reply on
  each thread with the fixing commit, and say when you disagree and why.
- After a merge: `git checkout main && git pull --ff-only`, delete the merged branch, rebuild
  `dist/` for local testing, and confirm every commit of the PR is in `main`.

## Releases

- Bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`) in the release PR,
  and in CHANGELOG.md turn `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty
  `## [Unreleased]` above it, and update the compare links at the bottom. The Chrome Web Store
  rejects a version it has already seen.
- After merging, tag the merged commit `vX.Y.Z` (annotated) and push the tag. The release workflow
  checks the tag matches `package.json`, builds, and creates a GitHub Release with that version's
  CHANGELOG.md section as its notes (it fails if the section is missing) and
  `testkube-for-github-X.Y.Z.zip` attached. Upload that zip to the Web Store, and update the listing texts there from
  STORE_LISTING.md when they changed.

## Ask instead of guessing

External identifiers such as the GitHub App slug, store URLs or product naming cannot be derived
from the code. Ask for them, or make the code fall back safely until they are confirmed, and say so.
