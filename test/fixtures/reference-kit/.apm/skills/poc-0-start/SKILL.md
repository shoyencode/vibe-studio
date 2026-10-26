---
name: poc-0-start
description: "Start or resume a pre-sales POC with the reference kit. Use when the user starts a new POC, asks how to begin, wants to configure the client, project, stack or language, or asks where the POC stands and what to do next. Creates or checks poc.yml, installs the stack packages and MCP servers, and points to the next skill."
---

# POC start

Give the user one entry point: a valid `poc.yml`, the right packages installed, and a clear next step.

## Hard constraints

1. Never overwrite an existing `poc.yml` value without the user's confirmation.
2. Never run `apm install` commands that the user has not seen in the plan of step 5.
3. Never invent client information: ask, or leave the field empty.

## Procedure

1. Anchor. Look for `poc.yml` at the project root. If it exists and `<root>/state.md` exists, go to resume mode (step 10). If `poc.yml` is missing but a `state.md` exists (POC started without it), run steps 2 to 9 with the folders already in use, keep every existing block of `state.md` (migrate them as in step 10), then finish with resume mode.
2. Ask. Ask only for what is missing, following the rule on questions and approvals: one question per `ask_user` call, with the default as the recommended choice. Items: client name and sector, project name, output language for the agent's replies and every file produced (recommended: the language the user writes in), front and back stacks (list the folders under `stacks/` of the kit, or `none`), database, code host (`github`, `azure-devops`, `gitlab`, `none`) and organization, three to five key needs, cost budget in GitHub AI credits (optional), whether the code will be delivered to the client or only demonstrated (default `demo-only`), and any contractual compliance requirement. If the request already gives the answers, use them without asking.
   Then ask the framing questions that no document answers, one per call: date and format of the demonstration (on site, remote), audience (business, IT, management), the scenarios that must impress first, client visual identity available (logo, colours, existing screens), constraints on client data (may it be used in the code repository), and what the user already knows from client meetings. Before writing anything, present a short summary of all answers and ask for confirmation.
3. Write `poc.yml` from `assets/poc-template.yml`. Keep the comments. Use `/` in paths. `poc.yml` holds no kit version: the installed version is read from `apm.lock.yaml`. When an existing `poc.yml` still has a `kit` section, remove it. Leave `run` empty: `poc-4-plan-scenario` fills it with the constitution.
4. Check. Run from the project root:
   `uv run --with pyyaml --with jsonschema python <this skill folder>/scripts/check_config.py --project .`
   It prints JSON: `valid`, `errors`, `warnings`, `kit_version`, `packages_to_add`, `mcp_commands`. Show `kit_version` to the user. Fix every error with the user, then run it again.
5. Plan the install. Show the user the packages to add to `apm.yml` (`packages_to_add`) and the MCP commands (`mcp_commands`). Wait for approval. If the request already approves the setup, record it and continue.
6. Install. Add each package to `dependencies.apm` of `apm.yml`, run each MCP command, then run `apm install`. Report any failure as is.
7. Folders. Create `paths.root`, `paths.sources` and `<root>/costs/` if missing.
8. State. Following the rule on working files, create `<root>/state.md` from `assets/state-template.md` if missing, with the "Framing" section filled from step 2 (demonstration date and format, audience, priority scenarios, visual identity available, constraints on client data, what the user knows from client meetings) and the phase 0 row of "Progress". Add to `<root>/state/journal.md` a block "Phase 0: start": date, client, project, stack, code host, packages installed, budget.
9. Cost mark. Run the `mark` command of the `poc-track-costs` skill with `--phase 0-start`. Then go to step 11.
10. Resume mode. If `state.md` still uses the older layout (phase blocks, mismatch, dependency or coverage tables, a decisions section, or more than about 150 lines), migrate it first: copy it to `<root>/history/state-v<n>.md`, move phase blocks to `state/journal.md`, mismatch and dependency tables to `state/analysis.md`, the coverage matrix to `state/coverage.md`, decisions to `state/decisions.md` with `Dnn` ids, then rewrite `state.md` from `assets/state-template.md`, keeping the framing and the open points. Headings follow the output language. Move content, never summarise it away. Tell the user what moved. Then run the check of step 4 and the `report` command of the `poc-track-costs` skill. Read `state.md` and give the user:
    1. the last completed phase and its date;
    2. open points and client questions still open;
    3. the cost so far against the budget;
    4. the deliverables still to approve, or changed since their approval (`status` command of "Deliverable approvals");
    5. the next skill to run, from the table below.
11. Next step. Name the next skill and recommend a new Copilot session for it: a clean context costs less, since a long session re-reads its whole history at every request. Chaining phases in one session stays possible; each phase cost is still measured. Remind the user to commit `<root>/costs/` so that every team member's sessions are counted.

## Deliverable approvals

`<root>/state/validations.md` records who approved which deliverable, when, and a fingerprint of the file. It is versioned with the project, shared by the team and read by Vibe Studio, which also offers an "Approve" button in Deliverables. A file changed after its approval shows the approval as outdated until it is approved again. The deliverables of each step are listed under `approves` in `assets/vibe-studio.json`.

1. When the user approves a deliverable at a checkpoint, record it from the project root:
   `python <this skill folder>/scripts/validations.py record --project . --path <deliverable> --step <phase> [--comment "<text>"]`
   The author is the git user name of the project. After "approve with changes", record once the changes are applied, with the conditions as comment. A pre-approval given in the request is recorded with the comment `pre-approved`.
2. Read the approvals: `python <this skill folder>/scripts/validations.py status --project .` (`current: false` means changed since the approval).
3. Never record an approval the user did not give, and never edit `validations.md` by hand.
4. The plan of a scenario also keeps its `Plan status:` line in `tasks.md`, which the build reads.

## Phase sequence

`assets/vibe-studio.json` is the versioned protocol-2 contract of the kit for Vibe Studio (`docs/vibe-studio-contract.md` of the kit repository). It describes the phase entry points, not a second set of business rules. When a launch context supplies a Vibe Studio run id, use the optional `vibe_studio_report` tool for progress, never for approving a decision. All checkpoints below still apply; installing Vibe Studio does not grant permission to install packages.

| Phase | Skill | Agent | Done when |
| --- | --- | --- | --- |
| 0 | `poc-0-start` | any | `poc.yml` valid, packages installed |
| 1 | `poc-1-import-documents` | `poc-analyst` | inventory confirmed |
| 2 | `poc-2-write-specification` | `poc-analyst` | specification written |
| 3 | `poc-3-ask-client` | `poc-analyst` | questions sent or answered; repeat 2 and 3 on answers |
| 4 | `poc-4-plan-scenario` | `poc-architect` | plan of the scenario approved |
| 5 | `poc-5-build-scenario` | `poc-developer` | every acceptance criterion of the scenario shown in the demo walkthrough |
| 6 | `poc-6-review-scenario` | reviewers | no blocking finding left |
| 7 | `poc-7-check-compliance` | any | no denied license; declaration of AI usage drafted |

Phases 4 to 6 repeat for each scenario, in the order recorded in `state/analysis.md`. Phase 7 needs at least one built scenario. It runs before the code is shown outside the team, and again before any delivery.

## Anchor check

Before finishing, re-read the three hard constraints and confirm none was broken.
