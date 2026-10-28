---
title: Tests and releases
description: Automated checks, continuous integration, commit and changelog conventions, and the release process.
---

# Tests and releases

## Checks

Run the smallest checks covering a change. Before a release or a change affecting several surfaces, run:

```powershell
npm test               # Node regressions
npm run test:bridge    # Python bridge regressions
npm run test:smoke     # desktop smoke with a fake harness
npm run test:workshop  # kit workshop smoke
npm run package
npm run test:portable  # real portable executable
```

All four harness adapters are covered with fake clients: no check makes an AI request or spends credits.
Smoke tests use temporary profiles, never your real profile or Start menu. Set `VIBE_STUDIO_SMOKE_ARTIFACTS`
to `dist\test-artifacts` to keep screenshots, and inspect them before sharing: they can contain local paths.

After packaging, set `VIBE_STUDIO_SMOKE_APP` to the absolute `dist\Vibe Studio-win32-x64\resources\app`
path and rerun the smokes to exercise the packaged modules.

## Continuous integration

[GitHub Actions](https://github.com/shoyencode/vibe-studio/actions) runs on pull requests, pushes to `main`,
version tags and manual dispatch:

1. Node and Python regressions on Ubuntu and Windows, plus the website build.
2. On Windows: desktop and workshop smokes, installer and portable build, bundled-application smokes, real
   portable executable and install/reinstall/uninstall preservation.
3. On a `vX.Y.Z` tag: a GitHub release with the verified installer and portable ZIP, then this website,
   built from the tagged commit and published to GitHub Pages.

The website therefore always describes the downloadable version. To publish a documentation fix between
releases, run the **pages** workflow manually from the Actions tab.

## Commits and changelog

- Commit messages are in English: `<type>(<scope>): <summary>`, with types `feat`, `fix`, `docs`, `refactor`,
  `test`, `ci`, `chore`, `release`.
- Every visible change gets an item under `## Unreleased` in `CHANGELOG.md`, in the same change.
- Breaking changes go under *Changed (breaking)* with a migration section.

## Releases

Releases follow Semantic Versioning (before 1.0.0, a feature raises the minor version).

1. Rename `## Unreleased` to `## X.Y.Z` and update `package.json` and `package-lock.json` together.
2. Run the full checks, including Windows packaging and the real portable smoke.
3. Commit `release: vibe-studio X.Y.Z`, then create the annotated tag `vX.Y.Z` with the message `Vibe Studio X.Y.Z`.
4. Pushing the tag publishes the release automatically after CI passes. A published tag is never moved.

Application updates detect releases whose assets are named `Vibe-Studio-Setup-X.Y.Z-x64.exe` with a
`sha256` digest; see [Updates](../guide/updates).
