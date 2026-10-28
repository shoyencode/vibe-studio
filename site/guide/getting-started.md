---
title: Getting started
description: Install a kit in a project folder, open it in Vibe Studio and run the first step.
---

# Getting started

This page takes you from an empty folder to the first completed step.

## 1. Install a kit in a project folder

Kits are distributed as [APM](https://github.com/microsoft/apm) packages. In a terminal (for example
**Vibe Studio tools** from the Start menu), create or choose the project folder, then install the kit:

```powershell
cd C:\Missions\my-project
apm install <kit package>
```

Use the target that matches your harness: Copilot by default, `--target claude`, `--target codex`, or
`--target copilot,gemini`. See [Harnesses](./harnesses).

::: tip No kit yet?
Official kits can be installed from **Official kits** in the application when a catalog is configured, and the
[kit workshop](../kits/tutorial) creates one from a mission description and tests it directly in a project.
:::

## 2. Open the project

Start Vibe Studio. On the **Projects** page, choose **Open a folder…** and select the project folder. Recent
projects stay listed. The project button at the bottom of the sidebar returns to this page without closing the
project; **Close project** disconnects idle conversations without changing any file.

The sidebar then shows the project's spaces: **Journey**, **Conversation**, **Deliverables**, **About**, plus
the spaces declared by the kit (units or scenarios, sources, application, costs).

## 3. Configure the project

The first step of most kits configures the project: Vibe Studio opens the configuration form (project name,
language, working folder…) before launching the AI. The file it writes, often `project.yml`, stays in your project.

## 4. Run a step

1. In **Journey**, the highlighted row is the step to handle now. Choose **Prepare**.
2. The launch dialog shows what the step does, its agent, the model, the context window and, when supported,
   the reasoning effort. Choose among the models the kit declares.
3. Add attachments if needed (screenshots, documents): they are copied into the project and given to the AI.
4. Confirm. Vibe Studio opens a new session of the harness and shows it in **Conversation**.

## 5. Follow and approve

- Answer the AI's **questions** and **permissions** in Conversation (allow once, allow for the step, or refuse
  with a reason). A tone and a Windows notification tell you when the AI waits.
- When the step ends, open its deliverables. When the kit asks for it, **approve** them: the step becomes
  approved and the journey highlights the next one.

Next: learn the [Journey](./journey) in detail.
