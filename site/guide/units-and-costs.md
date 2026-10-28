---
title: Units, tasks and costs
description: Repeated units of work, task tracking, the application space and measured consumption.
---

# Units, tasks and costs

These spaces appear only when the kit declares them in its contract.

## Units and tasks

A **unit** is a repeated piece of work — a scenario of a proof of concept, a page of an audit, a batch of a
migration. Some steps run once per unit. The units space lists them with their task tracking:

- Tasks come from the kit's task list (`T01`, `T02`… and corrections `R01`…), with the markers *to do*,
  *in progress*, *done* and *blocked*. Vibe Studio updates the marker when the AI reports a task.
- Review rounds list findings and corrections; you can add your own feedback corrections when the kit allows it.
- Scenario names always include their number, including in history.

## Application

Kits that build an application declare its services. Vibe Studio starts them in order and opens the
application from its space. Services run independently of AI steps: pausing a step does not pause them.

## Costs

Kits with cost tracking show **Costs**: a report per step and unit, loaded when the project opens and
refreshed on session usage and completion (at most every five seconds). It is the authoritative measurement;
conversation credits are never added on top. Unrecognised consumption says *Not measured*, never zero.

Before the first prompt of a Copilot step, Vibe Studio records the exact step, unit, session and run so that
costs can be attributed. If the kit cannot create that marker, the launch fails and no prompt is sent. The
Costs space measures Copilot sessions only.
