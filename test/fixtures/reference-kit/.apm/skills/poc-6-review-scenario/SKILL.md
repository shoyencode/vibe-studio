---
name: poc-6-review-scenario
description: "Review one built pre-sales POC scenario with a panel of independent reviewers (security, specification compliance, challenger), each in a separate context and on a different model family from the developer, collect the user's own feedback, then decide each finding with the user and offer to apply the fixes. Use when a scenario is built and the user asks for a review, a check before the demo, or what is left to fix."
---

# POC scenario review

Get independent opinions and the user's own feedback on a built scenario, decide each point with the user, and send accepted fixes back to the build.

## Hard constraints

1. Reviewers do not modify code. Fixes go through `poc-5-build-scenario`.
2. Each reviewer works in its own sub-agent context and never sees another reviewer's findings before the consolidation.
3. A Critical or High finding, or an acceptance criterion not compliant, blocks the demonstration until the user decides.
4. A POC favours speed and visual quality over code quality. Code style, structure, duplication and missing unit or integration tests are not findings. A missing or failing end-to-end test for an acceptance criterion is a finding.
5. No finding is fixed, accepted or rejected without an explicit decision of the user.

## Procedure

1. Anchor. Read `poc.yml`, `<root>/state.md`, and the `spec.md`, `plan.md` and `tasks.md` of the scenario. If the convergence table of `tasks.md` is empty, stop and suggest the `poc-5-build-scenario` skill. If `review.md` already exists, this is a new round: follow "Review rounds" below. Run the `mark` command of the `poc-track-costs` skill with `--phase 6-review-scenario --scenario <n>`.
2. End-to-end run. When `stack.e2e` is `playwright`, run from a clean start, before the panel, only the end-to-end tests of this scenario: the test files of the "Convergence" table of its `tasks.md`, passed as arguments to the end-to-end command of the constitution (for example `npx playwright test e2e/ac1-publish.spec.ts e2e/ac2-filter.spec.ts`). Do not run the tests of the other scenarios. Give the result to the reviewers. Each failing test becomes a High finding on its criterion; each acceptance criterion without a test becomes a Medium finding.
3. Scope. List the files changed for the scenario: git diff since the scenario started when the code folder is a git repository, otherwise the files named in `tasks.md` plus any file under `paths.code` modified after the plan approval date.
4. Panel. Launch three sub-agents in parallel, each with the scenario number, the file list, the paths of `spec.md` and `plan.md`, the `evidence/` folder of screenshots and the end-to-end results:
   1. `poc-security-reviewer`: access control, data exposure, secrets, dependencies;
   2. `poc-spec-reviewer`: compliance of each acceptance criterion, rule and displayed data, from the code and the demo screenshots;
   3. `poc-challenger`: what the demo would reveal as weak, wrong, missing or unfinished on screen, and hypotheses on open questions that the code turned into facts.
   Ask each one for findings with severity, file and line, and a proposed fix. Launch each reviewer as its custom agent when the sub-agent tool offers it; otherwise give the persona text as instructions and pass explicitly the `model:` written in the reviewer's agent file. Without an explicit model, the runtime picks its default model and the review loses its cross-family value. Note in `review.md` the model each reviewer actually used.
5. Consolidate. Write `<root>/build/scenario-<n>/review.md` from `assets/review-template.md`. Merge duplicates and keep the highest severity. Drop findings without a file, a quoted passage or a screenshot, and findings on code quality or missing unit tests. Fill the compliance table from the specification reviewer. Then run steps 2 and 3 of the `poc-7-check-compliance` skill without the declaration: each denied component becomes a High finding, each component to review a Medium finding, with the reason from `licenses.md`.
6. User feedback. Show the user the number of findings per severity, the screenshots of `evidence/` and the command to start the application. Ask, following the rule on questions and approvals, whether they have their own feedback on the scenario: yes, or no and move to the decisions. For each piece of feedback, ask what is missing to act on it (screen, expected result, priority), then ask whether there is another one. Record each as a finding with reviewer "user", the next free id and a severity proposed to the user. Feedback that changes the scope of the specification is recorded as a finding and, once decided, as a decision with `Report to specification: yes`.
7. Decisions. Go through the findings, blocking ones first, one question per finding: the finding in one sentence, file or screen, the proposed fix, and the choices fix (recommended for blocking findings), accept as is, reject. When several fixes are possible, ask which one. Low findings can be grouped in one question with a recommended answer for the group. Write each decision and its reason in `review.md`. Once every finding is decided, ask the user to approve `review.md` as the record of the round, and record the approval with `--step 6-review-scenario` (see "Deliverable approvals" in the `poc-0-start` skill).
8. Send back. Add each finding to fix as a task in the "Review corrections" section of `tasks.md` (French "Corrections issues de la revue"), with its id (R01, R02...), the chosen fix and the screen to check.
9. Record, following the rule on working files: a block "Phase 6: review of scenario <n>, round <k>" in `state/journal.md` (date, findings per severity and per reviewer, user included, decisions, tasks sent back) and the row of "Progress".
10. Offer the fixes. When tasks were sent back, list them and ask whether to apply them now (recommended) or later. If now: when the request comes from Vibe Studio (a run id is in the context), end this phase and tell the user to launch the scenario build from Vibe Studio; otherwise load the `poc-5-build-scenario` skill and run its "Review corrections" section in this session, starting with its cost mark.
11. Anchor check. Re-read the five hard constraints and confirm none was broken.

## Review rounds

A scenario is reviewed in rounds until a round leaves nothing to fix. A round starts when correction tasks R were done after the previous round, review findings or user feedback added from Vibe Studio or the chat.

1. Archive. Read `Review round:` in `review.md` (a file without this line is round 1 plus the number of `review-<k>.md` files). Rename it `review-<k>.md` and write the new `review.md` for round k+1 from the template. Never delete an archived round.
2. Corrections to check. List the R tasks marked `[x]` in `tasks.md` that are not in a `Corrections reviewed:` line of an earlier round. When the launch context gives them, use that list.
3. Scope. The files changed by these corrections. When `stack.e2e` is `playwright`, run from a clean start only the end-to-end tests linked to these corrections: the tests of the criteria and screens each correction names, found in the "Convergence" table of `tasks.md`, passed as arguments to the end-to-end command. Do not run the whole suite. When no correction touches a criterion with a test, run none and say so in `review.md`.
4. Panel. Give each reviewer the corrections to check, with their finding or feedback text. Each reviewer marks each correction it can judge: fixed, partial or not fixed, with the evidence; and looks for new findings only in what changed. Ids of new findings continue the numbering of `tasks.md` and of the earlier rounds.
5. Consolidate. Fill "Corrections checked" and the line `Corrections reviewed:` with every id checked. For a correction partial or not fixed, ask the user: reopen it (recommended) or accept it as is. Reopening sets its marker back to `[ ]` with a note "— round <k+1>: <what is missing>".
6. Then run steps 6 to 11 as for a first review. The scenario is ready for the demonstration when the round leaves no finding to fix and no correction reopened: say so to the user.

## Next step

If the fixes were postponed, suggest the `poc-5-build-scenario` skill. After the fixes, suggest a new review round, in a new Copilot session. When a round leaves nothing to fix, say the scenario is ready for the demonstration. Otherwise suggest the next scenario with `poc-4-plan-scenario`, or a cost report with `poc-track-costs` when all scenarios are done.
