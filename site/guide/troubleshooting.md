---
title: Troubleshooting
description: Answers to common problems with sign-in, kits, steps, notifications and updates.
---

# Troubleshooting

## The harness says it is not connected

Open **Settings › Harness**, choose **Sign in…**, complete the sign-in in the terminal, then **Check
connection**. Signing in to another desktop application, or a token valid only in one terminal, does not
guarantee that Vibe Studio has persistent credentials.

## The project opens but shows no journey

The folder needs a kit installed with APM and a current contract (`vibe-studio.json`, protocol 2). Update
older kits with APM before opening them. Other filenames or protocol versions are refused without changing
any project file.

## A step cannot be launched

- *Prerequisites missing*: the files the step requires do not exist yet; run the earlier steps.
- The step is approved: use **Reopen step** if you really need to change it.
- Cost tracking failed: the kit could not record its cost marker, so no prompt was sent. Update the kit.

## The AI is blocked by a guard

That is intended: the AI receives the reason. If the rule must be lifted, suspend the guard until the end of
the step in **Settings › Project and kit › Guards**.

## Pause does not finish

Pause waits for the harness to acknowledge. After 30 seconds an error asks you to retry Pause or stop the step.

## No Windows notifications

Check **Settings › Alerts** and Windows notification settings. The portable version needs its Start menu
shortcut, created automatically at first start.

## SmartScreen warns about the installer

The installer is not code-signed. Check that it comes from the
[official releases](https://github.com/shoyencode/vibe-studio/releases).

## Update check failed

Network failures, GitHub API rate limits and inaccessible repositories are reported explicitly. Retry later
from **About**.

## Still stuck?

Open an [issue on GitHub](https://github.com/shoyencode/vibe-studio/issues) with the version (shown under
**Refresh**) and the steps to reproduce. Do not attach client documents or logs containing private paths.
