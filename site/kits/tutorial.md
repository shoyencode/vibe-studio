---
title: "Tutorial: your first kit"
description: Create an accessibility audit kit from a mission description, review the AI's proposals, translate it and test it in a project.
---

# Tutorial: your first kit

In this tutorial you build a kit for an **accessibility audit of a website**, without writing any JSON. You
describe the mission, the AI drafts the kit, and you decide what goes in.

You need Vibe Studio with a [signed-in harness](../guide/harnesses). About fifteen proposals will be reviewed.

## 1. Describe the mission

Open **Kit workshop** in the sidebar.

<Shot name="workshop-start" alt="The Create a kit screen with the kit name, the mission and the Prepare the draft button" />

1. Choose the **Audit** example: it fills a mission you can adapt. Or write your own, as you would brief a colleague:

   > Run an accessibility audit of a public website. Agree on the scope with the client, analyse each page of
   > the sample, then write a report with prioritised fixes. The client approves the scoping note and the final report.

2. Give the kit a name, for example *Accessibility audit*.
3. Optionally open **Options** to attach reference documents (a sample report, a checklist), choose the
   writing language or the kit folder. By default the kit goes to `Documents\Vibe Studio\Kits`.
4. Choose **Prepare the draft**.

Identifiers, folders and the project configuration step are generated for you.

## 2. Follow the preparation

The AI reads the mission and publishes its plan as a short task list. It only **reads** the kit: it cannot
write files or run commands. If it needs an answer, its question appears on this screen.

<Shot name="workshop-preparing" alt="The preparation screen with the AI task list" />

Nothing is saved in the kit before your review. You can pause, or go back to the kit and come back later.

## 3. Review the proposals

Proposals arrive one at a time: the kit presentation, each step with its documents, repetition and approvals,
instructions for the AI, safety rules. On the right, the kit takes shape.

<Shot name="workshop-review" alt="A proposal with before and after columns and the Accept, Edit and Reject buttons" />

For each proposal:

- **Accept** it as is;
- **Edit** it — change the title, documents or instructions — then accept your version;
- **Reject** it;
- or **Ask for another proposal**.

Accepted proposals are saved immediately and always keep the kit valid. **Finish later** keeps the rest for
another time; a banner in the kit brings you back.

::: tip A step that repeats
When a step repeats "for each page", the kit gets a **repeated element** (here, *page*). In a project, each
page gets its own folder and the step runs once per page.
:::

## 4. Check the summary

<Shot name="workshop-summary" alt="The review summary with accepted and rejected counts, translation and verification" />

The summary counts accepted and rejected proposals, lists the texts still to translate and reports the kit
check. *Ready to test* means the contract and its files are valid.

## 5. Translate

Kit texts are written once, in the writing language. Choose **Prepare the translation**: the AI translates
every text, and you validate them side by side.

<Shot name="workshop-translation" alt="Source text and AI translation side by side with Validate the translation" />

Edit the translation if needed, then **Validate the translation**, or **Skip** a text. When you later change
a source text, its translations are marked *to update*. Instructions for the AI stay in the writing
language: in a project, the AI answers in the project's language.

## 6. Refine a step

Open the kit. The outline lists the presentation and the journey; each step has one plain page.

<Shot name="workshop-kit" alt="The kit view with the outline and the page of a step" />

Edit the title, what the step does, the expected result, the documents it uses and produces, whether it
repeats and whether the user approves its documents. Fields are saved when you leave them. **Ask the AI to
improve this step** opens a new review round for that step only.

The header's **Language** selector previews the kit as users of another language will see it. **Expert**
shows the technical settings and the raw contract, for developers.

## 7. Test it in a project

Choose **Test in a project** and pick an empty test folder. Vibe Studio installs a validated copy of the kit
and opens the project: your journey is there, ready for its first step.

## 8. Share it

In the **⋯** menu, **Share…** exports a ZIP file, or proposes the kit to the
[official catalog](./kit-catalog) for a manual review.

Next: everything the workshop can do, and how to write a kit by hand, in [Creating a kit](./creating-a-kit).
