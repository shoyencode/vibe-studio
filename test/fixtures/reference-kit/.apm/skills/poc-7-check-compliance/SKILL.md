---
name: poc-7-check-compliance
description: "Check the legal compliance of the code produced for a pre-sales POC before it is shown or delivered: CycloneDX SBOM per layer, license check of every dependency against the policy of poc.yml, third-party notices, and a client-facing declaration of AI usage. Use when the user asks about licenses, SBOM, third-party components, open-source compliance, legal checks before delivery, or how to tell the client that AI was used."
---

# POC compliance check

Make the legal status of the POC code explicit before it leaves the team: what third-party code it contains, under which licenses, and how AI was used to produce it.

## Hard constraints

1. Never state that the POC is legally compliant. Every deliverable says it supports, and does not replace, a review by the legal team.
2. Never mark a component as acceptable by reasoning: only the script, a policy entry in `poc.yml` or an exception approved by the user decides.
3. Never send the AI declaration or the license report to the client: the user decides after the legal review.

## Procedure

1. Anchor. Read `poc.yml` (`compliance`, `paths`, language) and `<root>/state.md`. If no scenario has screenshots in `<root>/build/scenario-<n>/evidence/`, no code has been built yet: stop, explain when this phase runs (after the first scenario is built, before the code is shown outside the team, and before any delivery), and suggest the `poc-5-build-scenario` skill. Steps 2 and 3 run from the review skill skip this check. Run the `mark` command of the `poc-track-costs` skill with `--phase 7-check-compliance`. If `compliance` is missing from `poc.yml`, add it from the `poc-0-start` template with `distribution: demo-only` and tell the user.
2. SBOM. For each layer under `paths.code`, run the SBOM command given in the "Commandes" section of `<root>/build/constitution.md`, or else in the stack rule of the project instructions. Write each SBOM to `<root>/compliance/sbom-<layer>.json`. Include runtime dependencies only; a folder that holds only test tooling never delivered (for example end-to-end tests) is skipped and named as skipped in the state record. On Windows PowerShell, quote every `-D<property>=<value>` argument and use absolute paths. Then export the AI tooling inventory: `apm lock export --format cyclonedx -o <root>/compliance/sbom-ai-tooling.json`.
3. Check. Run from the project root:
   `uv run --with pyyaml python <this skill folder>/scripts/check_licenses.py --project . --sbom <root>/compliance/sbom-<layer>.json ... --notices <paths.code>/THIRD_PARTY_NOTICES.md`
   It writes `<root>/compliance/licenses.md` and `licenses.json`. Exit code 1 means a denied component without exception. Do not pass the AI tooling SBOM: it describes the tooling, not the delivered code.
4. Analyse. For each component to review or denied, find what uses it (direct or transitive, `mvn dependency:tree` or `npm ls <name>`) and propose one option: replace it (name the alternative and its license), remove it, or ask for an exception with a reason the legal team can assess. For a component listed with several licenses, read its official POM, package or license file: when it states a choice (`OR`), say so; the user may then approve an exception naming the license retained.
5. Delivered code. When `compliance.distribution` is `delivered`, build the artefacts that will be handed over (build commands of the constitution), then run:
   `python <this skill folder>/scripts/audit_artifacts.py --artifact <archive or output folder> ... --sbom <root>/compliance/sbom-<layer>.json ... --out <paths.code>/THIRD_PARTY_LICENSES`
   It lists the libraries packaged in archives (`BOOT-INF/lib`, `WEB-INF/lib`, `lib/`) that are missing from the SBOM, the code embedded inside libraries (`META-INF/licenses/`), and copies the license, notice and bundler license files. Then:
   1. add each library missing from the SBOM to `licenses.md`, with its license from the official source and its status under the policy;
   2. list the embedded code with its license in `licenses.md`;
   3. `THIRD_PARTY_NOTICES.md` is an inventory; `THIRD_PARTY_LICENSES/` holds the full texts and copyright notices that ship with the code;
   4. state the runtime the client must install (JDK, Node) and its license, outside the inventory.
6. Declaration. If `compliance.ai_disclosure` is true, write `<root>/compliance/ai-disclosure.md` from `assets/ai-disclosure-template.md`. Every statement needs evidence in the POC files; otherwise it is written "to be confirmed" in the output language and listed in section 6. In particular:
   1. models: the configured model comes from the `model:` field of the deployed agent files (`.github/agents/*.agent.md`); the observed model comes from the models column of `costs.md` for the phase. Show both; never present a configured model as observed. `auto` means automatic selection: the model actually run is "to be confirmed";
   2. human control: only a decision recorded in `state/decisions.md`, `tasks.md` or `review.md` as taken by a named person counts. A decision taken by an agent is written as such;
   3. client data: say which documents were converted and read by the models (`inventory.json`) and, for each, whether it is in the code repository as is, partially anonymised or absent, from `state.md` and `state/decisions.md`;
   4. MCP servers from `.github/mcp.json`; demo walkthrough evidence and review findings from each scenario's `tasks.md` and `review.md`;
   5. Copilot plan, data retention and the public-code filter are always "to be confirmed" unless the user states them.
7. Checkpoint. Present to the user: the summary of `licenses.md`, the options of step 4, and the points to confirm of the declaration. Ask for a decision on each component to review or denied. Wait for the answer. Record approved exceptions in `compliance.exceptions` of `poc.yml` with their reason, and run step 3 again. When the user approves the report, record the approval of `licenses.md` with `--step 7-check-compliance`. Record `ai-disclosure.md` only when the user says the legal team validated it, with the comment `legal team` (see "Deliverable approvals" in the `poc-0-start` skill).
8. Record, following the rule on working files, a block "Phase 7: compliance" in `state/journal.md` and the row of "Progress": date, distribution, layers checked and skipped, components per status, exceptions, declaration status (draft, validated by the legal team on <date>).
9. Anchor check. Re-read the three hard constraints and confirm none was broken.

## Next step

When the status changes (new dependency, `distribution` switched to `delivered`), run this skill again. When the user plans to hand the code over, remind them that the declaration and the notices go with it once the legal team has validated them.
