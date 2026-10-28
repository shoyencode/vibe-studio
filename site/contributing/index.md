---
title: Build from source
description: Set up a development environment, run Vibe Studio from source and build the portable version and the installer.
---

# Build from source

Vibe Studio is an open-source Electron application under the MIT licence. Contributions follow
[CONTRIBUTING.md](https://github.com/shoyencode/vibe-studio/blob/main/CONTRIBUTING.md); three rules come first:

1. No client data, secrets or credentials in source, tests, examples or screenshots.
2. Keep the application standalone: no sibling kit checkout, developer-specific path or real user profile in tests.
3. Validate behaviour, not assumptions. Preserve deployed kit contracts and existing user data.

## Repository layout

| Path | Content |
| --- | --- |
| `app/` | Electron main process, preload, desktop interface and local preferences |
| `core/` | Project controller, Python bridge, guards, journal, Markdown renderer, translations, contract schema |
| `core/adapters/` | Copilot, Claude Code, Codex and Gemini harness adapters |
| `test/` | Node and Python regressions with fake harnesses and licensed reference-kit fixtures |
| `scripts/` | Packaging, installer and isolated Electron smoke checks |
| `docs/` | Contract and kit-authoring documentation, included in this site |
| `site/` | This website (VitePress) |
| `catalog-template/` | Scaffold of the separately published official kit catalog |

## Run from source

Requirements: Node.js 22.12+ and Python 3.11+ (CI uses Node.js 24 and Python 3.12).

```powershell
npm ci
python -m pip install -r requirements.txt
npm start
```

Use an isolated profile rather than your real one:

```powershell
npm start -- --user-data-dir="C:\Temp\vibe-studio-profile"
```

## Portable version

```powershell
npm run package
```

On Windows x64 it writes `dist\Vibe Studio-win32-x64\Vibe Studio.exe` and a ZIP. Close running portable copies
first: packaging refuses to overwrite an executable in use.

## Windows installer

Requirements: Windows x64, Node.js 22.12+, Python with pip, and Internet access to prepare the distribution.

```powershell
npm ci
npm run installer:tools
npm run package:installer
npm run test:installer
```

`installer:tools` downloads and verifies a portable Inno Setup under `dist\installer-cache`. The build produces
`dist\Vibe Studio-Setup-<version>-x64.exe` with a pinned Python runtime and hash-locked wheels; optional tool
archives are pinned with checksums in `scripts\installer\components.json`.

## This website

```powershell
npm run site:dev          # live preview on http://localhost:5173/vibe-studio/
npm run site:build        # production build, fails on dead links
npm run site:screenshots  # regenerate application screenshots with the demo kit
```

Pages live in `site/` in English and `site/fr/` in French; update both languages together. Reference pages
include `docs/*.md` instead of copying them, and the Versions page is generated from `CHANGELOG.md`.
