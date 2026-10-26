---
name: poc-4-plan-scenario
description: "Plan the technical build of one pre-sales POC scenario before any code: project constitution with visual identity (once), scenario contract with acceptance criteria ids, technical plan (data model, API, screens, stubs, seed data, demo walkthrough) and an ordered task list. Use when the specification is validated and the user wants to start building, design a scenario, or prepare tasks for the developer."
---

# POC scenario plan

Turn one scenario of the specification into a plan and tasks a developer can execute fast without guessing, where every acceptance criterion is shown on screen in the demo walkthrough.

A POC is judged on screen. Speed of delivery and visual quality come first; code quality comes after. The plan contains no unit or integration tests. The only automated tests are Playwright end-to-end tests, one per acceptance criterion, that play the demo walkthrough and save its screenshots.

## Hard constraints

1. Write no application code in this skill.
2. Every acceptance criterion, business rule, displayed data and interface of the scenario has an id in `spec.md`, at least one task and at least one step of the demo walkthrough in the plan. When `stack.e2e` is `playwright`, every acceptance criterion also has its end-to-end test task. Nothing in the plan exceeds the specification.
3. No task list goes to the developer before the user approves the plan.

## Procedure

1. Anchor. Read `poc.yml` (stack, `paths.code`, language) and `<root>/state.md`. If phase 2 is not recorded, stop and suggest the `poc-2-write-specification` skill.
2. Choose the scenario: the one named in the request, otherwise the first scenario of the dependency order in `state/analysis.md` without an approved plan. Confirm the choice with the user. Run the `mark` command of the `poc-track-costs` skill with `--phase 4-plan-scenario --scenario <n>`.
3. Framing questions. Read the "Framing" section of `state.md`, `state/decisions.md` and the scenario section of the specification. Then ask the user, following the rule on questions and approvals, only what they do not answer, one question per call:
   1. first scenario only: visual identity (component library, with a recommended choice for the stack; client logo and colours to use; screens or a product the client likes as a reference) and the device of the demonstration (projector, laptop, both);
   2. for each open question `[Qnn]` of the scenario: keep the hypothesis of `questions.md` (recommended), or apply an answer the user already has from the client;
   3. for each interface of the scenario: real access available for the POC, or stub (recommended when no access is confirmed);
   4. seed data: anonymised data derived from the client files (recommended), or client files allowed in the code repository; the volume a demonstration needs;
   5. the screen that must impress first, and what the presenter wants to show on it;
   6. what can be dropped first if time runs short.
   Record the answers in `state/decisions.md`. A decision that adds to or changes what the specification describes gets `Report to specification: yes`.
4. Constitution, first scenario only. If `<root>/build/constitution.md` does not exist, write it from `assets/constitution-template.md`, using the answers of step 3:
   1. stack and versions from `poc.yml`: use the version already installed on the machine when there is one, otherwise the current stable version from the official documentation;
   2. exact build and run commands, one set per layer when front and back are separate, with unit test generation and execution turned off; when `stack.e2e` is `playwright`, the command that runs the end-to-end tests from a clean start, with Playwright starting the application through its `webServer` setting;
   3. the stack rules found in the project instructions (`.github/instructions/`), summarised in the "Stack rules" section;
   4. visual identity: one component library and its theme, colours, logo and typography, as decided in step 3. When the user gave no preference, take the client's colours and logo from the sources when they exist and the client allows them; otherwise choose a sober, professional theme and say so. Name the screen sizes of the demo (by default 1920 × 1080 for a projector and 1366 × 768 for a laptop);
   5. folder layout under `paths.code`;
   6. libraries not named in `poc.yml` that the scenario needs, each with its reason and its license, checked against `compliance` of `poc.yml` and the policy of the `poc-7-check-compliance` skill; a denied license is not an option. Prefer a library that saves time or improves the screens;
   7. the SBOM command of each layer, taken from the stack rule, in the "Commandes" section;
   8. the `run` section of `poc.yml`, used by the "Launch the POC" button of Vibe Studio: one service per layer and per tool the demonstration needs (database server, mail catcher, stub of an external system), in start order. Each service has `name`, `cwd` relative to the project root, the `command` that starts it in the foreground, the `port` that answers once it is ready, and `url` when it has a screen; `open` is the address of the application. Use the run commands of the constitution, nothing else. Show the section to the user before writing it: Vibe Studio runs these commands after the user confirms them.
5. Contract. When the scenario already has a plan (re-planning), copy its `spec.md`, `plan.md` and `tasks.md` to `<root>/history/` first, as the rule on working files says. Write `<root>/build/scenario-<n>/spec.md` from `assets/spec-template.md`. Copy the acceptance criteria, rules, displayed data and interfaces of the scenario section of the specification, give each an id (AC, BR, UI, IF), and list the open questions `[Qnn]` with the hypothesis decided in step 3. When the specification gives a single global criterion, split it into observable criteria along the steps of the flow, each citing its step. Add nothing the specification does not say.
6. Existing code. Read what earlier scenarios built under `paths.code` and their `plan.md`. Reuse screens, components and data before adding.
7. Plan. Write `<root>/build/scenario-<n>/plan.md` from `assets/plan-template.md`, using the answers of step 3. For each screen, say what the user must see at first glance. For each interface not available for the POC, design a stub with the same contract and say where it lives. Design access control and seed data explicitly. Seed data must look real on screen: plausible names, amounts and dates, enough rows to fill a table. Client files may serve as seed data only if the client allows them in the code repository; until then, derive anonymised data with the same format and record the question in "Open points" of `state.md`. Write the demo walkthrough: the ordered steps a presenter follows from a clean start, each with the screen, the action and the visible element that proves the criterion. When a design choice with a visible effect is not settled by the files or the answers of step 3, ask the user before writing it.
8. Tasks. Write `<root>/build/scenario-<n>/tasks.md` from `assets/tasks-template.md`. Order: setup (first scenario only, including the Playwright project under `<paths.code>/e2e` when `stack.e2e` is `playwright`), foundations, one group per acceptance criterion, visual finish, demonstration. The demonstration group holds the seed data task, then one end-to-end test task per acceptance criterion, written after the visual finish so that screens are stable. Each task names its files, its done condition stated as what is visible on screen (or, for a test, the test passing from a clean start), and the ids it serves. No task writes unit or integration tests.
9. Consistency check. Build for yourself the matrix id → tasks → walkthrough steps → end-to-end test. Fix every id without a task or a step, every task serving no id (except setup and visual finish), and every task that contradicts the constitution. Check that each open question appears with its hypothesis. Check that each interface signature in the plan carries every piece of data the component needs to do what the plan says, and that every walkthrough step names a visible element, not an internal state.
10. Checkpoint. Present to the user: the components, the stubs, the visual identity, the hypotheses on open questions, the number of tasks and the demo walkthrough. Ask for approval with explicit choices: approve, approve with changes, rework. On changes, apply them, then ask again. If the request already approves the plan, record it as pre-approved. Replace the status line at the top of `tasks.md` by `Plan status: approved on <date> by <who>`; while waiting, it reads `Plan status: pending`. These codes stay in English in every output language. If the approval comes with a condition that changes the contract (data, stub, scope), update `spec.md`, `plan.md` and the affected tasks before recording the approval, so that the developer and the reviewers work from one consistent contract. Then record the approval of `spec.md` and `plan.md`, and of `constitution.md` when it was written or changed in this run, with `--step 4-plan-scenario` (see "Deliverable approvals" in the `poc-0-start` skill).
11. Record, following the rule on working files: a block "Phase 4: plan of scenario <n>" in `state/journal.md` (date, number of tasks, stubs, hypotheses used, decisions, approval) and the row of "Progress". If decisions are marked to report, tell the user and suggest the update mode of `poc-2-write-specification`, so that reviewers compare the code with an up-to-date specification.
12. Anchor check. Re-read the three hard constraints and confirm none was broken.

## Next step

Suggest the `poc-5-build-scenario` skill with the `poc-developer` agent, in a new Copilot session (recommended), or as a new request in this session.
