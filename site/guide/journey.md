---
title: Journey
description: The register of steps, live indicators, approvals and reopening a step.
---

# Journey

The Journey is the home of an open project. It stacks three bands:

1. A **heading** with a one-line summary of the displayed steps.
2. The **live indicator strip**: session, AI questions and permissions, guards, consumption. Each cell opens
   the matching space (Conversation, Settings › Guards, Costs).
3. The **register**: one dated entry per step and the launch history, which scroll together.

## Register entries

Each entry shows its date and time, the step title, the files it produced and a status badge: *Approved on…*,
*Awaiting a response*, *In progress*, *Upcoming*, *Prerequisites missing*. The entry to handle now is
highlighted in blue with its primary action: **Prepare** the next step, or open the active conversation.

Dates come from the latest current approval, otherwise from the last run or the latest produced file. An
unknown date shows "—", never a made-up date.

## Steps per unit

When a kit repeats steps per unit (scenario, topic, batch), the register shows them for the selected unit.
Unit selectors include the number and, when available, the first heading of the unit's deliverable. A kit
can declare its scenarios in advance: they all appear before their folders exist, and you choose one by its
business title.

## Approvals

A step is **approved** when every file in its `approves` list has a current approval. Its launch button is
then disabled, including in the core API, so an approved step cannot be rerun by mistake.

To change an approved step, choose **Reopen step**. Vibe Studio asks for confirmation and appends a
revocation to the approval file; documents and previous approvals are kept. Reopening a shared document can
also invalidate another step that depends on it.

## Automatic completion

A build step that declares no human approval checkpoint completes automatically when its final report,
evidence, completed tasks and end checks are all present when the AI becomes idle. It shows *Automatically
completed* with a link to its conversation. Interrupted, failed or incomplete builds are never validated.
