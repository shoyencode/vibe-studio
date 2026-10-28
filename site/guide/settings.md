---
title: Settings and alerts
description: Appearance, alerts and sounds, harness selection and project settings.
---

# Settings and alerts

The gear at the bottom of the sidebar opens **Settings**, even without an open project.

## Personal settings

- **Appearance**: light, dark or system theme.
- **Alerts**: sounds and Windows notifications. A short tone marks a question or permission, the end of a
  step, or an error. When the window is not in front, a Windows notification opens the conversation on click.
- **Harness**: the AI runtime, its sign-in and model catalog. See [Harnesses](./harnesses). The harness can
  change only when no step or conversation is running.

Personal preferences live in `%APPDATA%\Vibe Studio\preferences.json`, never in the project.

### Sound themes

Choose and preview a theme in **Alerts**. Each theme has a question, a success and an error sound:

- Arcade 8-bit, Orbital station, Telegraph and Analog noir — original short motifs.
- Recorded acoustic piano and Recorded acoustic guitar — real recorded notes (CC BY 3.0, see
  `THIRD-PARTY-NOTICES.txt`), bundled for offline use.

## Project and kit

When a kit is open, **Project and kit** contains the project configuration, the guards and the kit
information. The versions of the kit and of Vibe Studio are shown under **Refresh** in the sidebar.

## Taskbar activity

While an operation, an AI step or a free conversation works, the Windows taskbar icon shows the native
indeterminate progress, even when the window is minimized. Questions waiting for you and paused steps do not
count as ongoing work.
