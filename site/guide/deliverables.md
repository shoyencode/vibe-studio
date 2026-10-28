---
title: Deliverables and approvals
description: Read deliverables, approve them, reopen a step and open client sources.
---

# Deliverables and approvals

## Deliverables

**Deliverables** groups the files the kit declares, by section. Markdown deliverables open at full content
width; **Open file** opens the document in its default desktop application. Executable formats and paths
outside the project are refused.

## Approving

When a step must be approved, the kit asks you in Conversation, then records your approval with its own
approval script. The approval is dated and appears in the register: *Approved on 22/10*. A report from the AI
is never an approval, and Autopilot never approves on your behalf.

A step is approved when every file in its `approves` list has a current approval. To change an approved
document, use **Reopen step** in the Journey: revocations are appended, previous approvals and documents are kept.

## Client sources

Kits with a sources module show **Client Sources**: drop the client's documents into the declared folder; the
import step converts them so the AI can read them. Each document offers **Read** (the conversion), **Open
file** and **Open original**.

## Manual corrections

Correction tasks (R) from reviews or feedback can be handled without the AI when needed: **Edit**,
**Validate manually** or **Delete**. Manual validation only marks the task done; it never approves a
deliverable. Deleted identifiers are reserved and not reused. These actions are blocked while a step on the
unit or a free AI turn is active.
