---
title: Harnesses
description: Copilot CLI, Claude Code, Codex CLI and Gemini CLI — sign-in, kit deployment and differences.
---

# Harnesses

Vibe Studio drives one harness at a time, chosen in **Settings › Harness**. Each harness needs the kit
deployed for it by APM and a sign-in on the computer.

## Signing in

On Windows, each harness has a **Sign in…** button that opens its official sign-in command in a visible
PowerShell terminal, using Vibe Studio's tool paths. Complete authentication there, then choose **Check
connection**. Credentials never pass through the interface; missing tools are reported instead of claiming a
connection.

## Comparison

| Harness | Deploy the kit | Sign-in | Specifics |
| --- | --- | --- | --- |
| **GitHub Copilot CLI** | `apm install` | `gh auth login --hostname github.com --web` | Reference harness: every function of Vibe Studio, runtime built in. |
| **Claude Code** | `apm install --target claude` | `claude auth login` or `ANTHROPIC_API_KEY` | Agents run as the main thread; reads inside the project are approved by Claude Code. Requires Git Bash. |
| **Codex CLI** | `apm install --target codex` | `codex login` | No named agent: the agent prompt becomes developer instructions; read-only commands run without asking. |
| **Gemini CLI** | `apm install --target copilot,gemini` | `gemini`, then `/auth`, or `GEMINI_API_KEY` | No agent selection; file writes go through Vibe Studio; the project is trusted. |

## What stays the same

For every harness, guards are checked before each write, command and skill; `vibe_studio_report` and, when
missing, `ask_user` are offered as Vibe Studio tools; the kit's models are replaced by the closest model of
the harness, shown in the launch dialog.

## Models, context and effort

The launch dialog offers the models the kit declares, a context window and, when the harness supports it, a
reasoning effort (Copilot, Claude, Codex; not Gemini). Choices come from the connected harness's catalog,
never from a guessed table. When pricing provides a prompt budget, it is labelled as maximum **input
tokens**. **Refresh** the catalog to check recently changed availability. Copilot keeps its last successful
catalog if discovery fails, and says so.

::: info Limits
The long context window is a Copilot option, and the Costs space measures Copilot sessions only.
:::
