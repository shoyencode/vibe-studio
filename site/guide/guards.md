---
title: Guards
description: Kit rules enforced before the AI acts, end-of-step checks and suspending a guard.
---

# Guards

Guards are the kit's rules, imposed on the AI by Vibe Studio rather than requested from it. Before each
write, command or skill the harness asks to run, Vibe Studio checks the guards. A blocked action is refused
before it runs and the AI receives the reason and what to do instead. Reads are never blocked, and a guard
never approves anything: your permissions stay in force.

## What a kit can guard

| Guard | Effect |
| --- | --- |
| Read-only files | No tool and no shell command writes these paths. |
| Script-only files | Only the kit's named scripts write these paths (for example approvals). |
| No new files | Existing files stay editable; no new file matching the paths. |
| Task in progress | Writing these paths needs a task marked in progress. |
| One task at a time | The AI cannot report a second task in progress. |
| Secrets | No written content that looks like a token, a private key or a password. |
| Confirmed commands | Matching shell commands are confirmed by you, even under Autopilot. |
| Skills | Skills of other steps are refused. |
| Read-only sub-agents | Sub-agents of the step only read. |
| History | Before a file is rewritten, a numbered copy is kept. |
| End checks | When the AI ends its turn: final report, no task left in progress, file modified, plan status, review decided. A failed check sends the AI back with the reasons, twice at most, then alerts you. |

The full format is in the [contract reference](../kits/vibe-studio-contract#guards).

## Where you see them

- A blocked action shows in Conversation and under the running step's register entry, in orange.
- The **Guards** cell of the Journey strip counts blocks.
- **Settings › Project and kit › Guards** lists the rules, the blocked actions and the end checks. You can
  **suspend** a guard until the end of the step when you decide so; each change is kept in the journal.

::: warning Limits
Detection of shell writes is best effort. Actions a harness runs without asking (mostly reads) escape the
guards, and sessions opened outside Vibe Studio are not guarded. Guards are guardrails, not an
operating-system sandbox.
:::
