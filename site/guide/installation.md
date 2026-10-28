---
title: Installation
description: Install Vibe Studio on Windows with the installer or the portable version, then sign in to a harness.
---

# Installation

## Requirements

- Windows 10 22H2 or Windows 11, x64.
- A GitHub Copilot, Claude, OpenAI or Gemini account for the harness you plan to use.
- No administrator rights, system Python or Node.js are required with the installer.

## Windows installer (recommended)

1. Download `Vibe-Studio-Setup-X.Y.Z-x64.exe` from the [latest release](https://github.com/shoyencode/vibe-studio/releases/latest).
2. Run it. It installs for the current user in `%LOCALAPPDATA%\Programs\Vibe Studio`, without administrator rights.
3. Choose the components:
   - The **application** always includes Electron, the Copilot runtime, a private Python with `pyyaml` and
     `jsonschema`, and the GitHub CLI for personal sign-in.
   - **Git** (with Git Bash) and **Microsoft APM** are checked by default.
   - **Claude Code**, **Codex** and **Gemini** are optional and unchecked.
   - **Offline application only** installs the base without any download.
4. Review your choices and follow the preparation phases. Optional tools need Internet; compatible tools
   already on your PATH are reused, missing ones are downloaded, verified and installed privately.

The installer follows the system's light or dark appearance and is available in French and English. It never
changes your Windows PATH, existing tools, projects or personal accounts. The result is saved in
`setup\installation-result.txt` under the installed application.

::: tip Adding a tool later
Run the installer again and check the tool. Unchecking an already installed tool does not remove it.
:::

::: warning SmartScreen
The installer is not signed with a code-signing certificate: Windows may show a SmartScreen warning.
:::

## Portable version

Download `Vibe-Studio-X.Y.Z-win32-x64.zip` from the same release and unzip it anywhere in your user space, then
start `Vibe Studio.exe`. The portable version includes Electron and the Copilot runtime, but not Python or the
other CLIs: install Python 3.11+ with `pyyaml` and `jsonschema`.

The portable version adds a *Vibe Studio* shortcut to your Start menu so that Windows can display its
notifications. Close every running copy before replacing the folder.

## Sign in to a harness

Open **Vibe Studio tools** from the Start menu: it opens a terminal with Vibe Studio's private tools. Then
sign in to the harness you will use:

| Harness | Command |
| --- | --- |
| GitHub Copilot CLI | `gh auth login` (an existing Copilot sign-in also works) |
| Claude Code | `claude auth login` |
| Codex CLI | `codex login` |
| Gemini CLI | `gemini`, then `/auth` |

You can also sign in from the application: **Settings › Harness › Sign in…** opens the official command in a
visible terminal, then **Check connection** refreshes the account. Credentials never pass through the interface.
See [Harnesses](./harnesses).

## Uninstall

Uninstall from Windows **Settings › Apps**. The uninstaller removes its own files and shortcuts. It keeps
reused external tools, your projects, credentials and your profile in `%APPDATA%\Vibe Studio`.

Next: [open a first project](./getting-started).
