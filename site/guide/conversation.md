---
title: Conversation
description: Follow the AI, answer questions and permissions, use Autopilot, pause and resume, attach files.
---

# Conversation

Conversation shows the active session: the AI's messages and tools, its questions and permission requests,
and a message box. When the AI waits, a notice and a mark on **Conversation** tell you so wherever you are.

## Questions and permissions

- **Questions** list the AI's choices; answer with one click or a free text when allowed.
- **Permissions** ask before a write or a command: **Allow once**, **Allow for the step**, or **Refuse** with a reason.
- Guard confirmations (see [Guards](./guards)) are always asked, whatever the switches below.

## Free conversation

**New conversation** opens a session in the project outside the journey: choose the agent and the model.
Permanent guards apply; there is no step and no report.

## Autopilot and Approve All

- **Autopilot** applies to every session while it is on: tools are allowed and questions answered without
  you, except confirmations imposed by guards. The AI is told never to record an approval on your behalf.
- **Approve All** (when Autopilot is off) allows tools automatically and leaves questions to you.

Both keep guard refusals and required confirmations.

## Pause, resume, stop

**Pause** interrupts the current AI turn, cancels unanswered prompts without approving them and keeps the
same session, context, files, draft and metrics. **Resume** appears once the harness acknowledges the pause,
and asks the AI to continue from the current files without repeating completed actions.

Actions already performed are not undone, and independent project services are not paused. If the harness does
not acknowledge within 30 seconds, an explicit error asks you to retry or stop the step. Same-session resume
works while Vibe Studio stays open; after a restart, the session is marked interrupted.

## Attachments

Choose files, drop them on the message box, or paste an image. Up to 10 files of 25 MB each; they are copied
next to the scenario or under `<root>/attachments/` and sent to the harness. Drafts survive view changes.

## Metrics

A rail beside the messages (above them on narrow windows) shows the model, context tier, capacity and occupancy
when reported, cumulative input and output tokens, cache usage and AI credits, including subagents.
Consumption is not the current context size. A missing value says *Not reported*, never an estimate.

## Previous conversations

The latest session stays visible; older ones sit in a **Previous conversations** section that you can
collapse. The choice is remembered.
