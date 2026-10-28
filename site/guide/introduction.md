---
title: What is Vibe Studio?
description: The concepts behind Vibe Studio — kits, contracts, harnesses, steps and approvals.
---

# What is Vibe Studio?

Vibe Studio is a Windows desktop application that drives **AI kits** step by step. A kit packages the
skills, agents and rules for one kind of mission — a proof of concept, an audit, a migration. Vibe Studio reads
the kit's contract, launches each step of the mission in a fresh AI session, and keeps you in control: you
answer the AI's questions, grant or refuse its permissions, and approve each deliverable before the journey moves on.

It works on top of the AI tool you already use — GitHub Copilot CLI, Claude Code, Codex CLI or Gemini CLI —
which Vibe Studio calls a **harness**.

## The pieces

| Term | Meaning |
| --- | --- |
| **Project** | A folder on your computer where a kit is installed. Your documents and deliverables live there. |
| **Kit** | An [APM](https://github.com/microsoft/apm) package of skills, agents and rules, plus a contract. One kit per kind of mission. |
| **Contract** | `vibe-studio.json`, shipped by the kit. It describes the journey: steps, files they need and produce, approvals, guards. See the [contract reference](../kits/vibe-studio-contract). |
| **Harness** | The AI runtime that executes a step: Copilot CLI, Claude Code, Codex CLI or Gemini CLI. Chosen in Settings. |
| **Step** | One stage of the journey (for example *Write the specification*). Each run opens a new AI session. |
| **Unit** | A repeated piece of work, such as a scenario or a page to audit. Some steps run once per unit. |
| **Guard** | A rule of the kit that blocks an AI action before it happens (no secret written, protected files, confirmed commands). |
| **Approval** | Your explicit sign-off on a deliverable. A step is complete when every file it must approve has a current approval. |

## What Vibe Studio adds to a kit

- **A readable journey.** Every step appears in a dated register with its produced files and a status badge.
  The row to handle now is highlighted, with its action.
- **Supervised sessions.** Questions and permissions from the AI appear in Conversation; a tone and a Windows
  notification bring you back when the window is not in front. Pause, resume or stop at any time.
- **Guards enforced for every harness.** Writes, commands and skills are checked before they run.
- **Deliverables you approve.** Markdown deliverables open at full width; approvals are dated and can be reopened.
- **Measured consumption.** Tokens, AI credits and context occupancy are shown when the harness reports them —
  never estimated.
- **A kit workshop.** Describe a mission and let the AI draft a complete kit that you review proposal by
  proposal. See the [tutorial](../kits/tutorial).

## What it does not do

- It does not sign in for you, buy subscriptions or deploy kits automatically.
- It never sends a prompt just to create a log, and never invents a metric: missing values say *Not reported*.
- It does not rename or rewrite client files. Guards are guardrails inside the harness, not an operating-system sandbox.

Next: [install Vibe Studio](./installation).
