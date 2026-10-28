---
title: Data and privacy
description: Where Vibe Studio keeps its data, and what it never does with yours.
---

# Data and privacy

| Data | Location |
| --- | --- |
| Preferences, recent projects, step journals | `%APPDATA%\Vibe Studio` |
| Project configuration, deliverables, approvals, attachments | the project folder |
| Installed application and private tools | `%LOCALAPPDATA%\Programs\Vibe Studio` |
| Harness credentials | the harness's own storage — never Vibe Studio |

- Vibe Studio never inspects or imports another application's profile or journal.
- Pasted staging files are removed when the application closes normally; copies in the project stay.
- Free conversation metrics stay in memory for the window; step metrics are kept in the local journal.
- Update checks read GitHub's public API anonymously; no token is requested or reused.
- The kit workshop sends reference documents to the AI for the first draft only; they are not copied into the kit.

## Isolated profile

To try Vibe Studio without touching your profile, start it with an explicit data folder:

```powershell
"Vibe Studio.exe" --user-data-dir="C:\Temp\vibe-studio-profile"
```

Back up `%APPDATA%\Vibe Studio` before upgrading.

::: warning Client data
Kits are meant to be shared. Do not put credentials or client data in a kit, and review generated
instructions before sharing it.
:::
