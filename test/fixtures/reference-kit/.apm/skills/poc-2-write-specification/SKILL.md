---
name: poc-2-write-specification
description: "Write or update the functional specification of a pre-sales POC from ingested client documents. Use when the user asks for a specification, a scope document, scenarios, business rules or acceptance criteria for a POC, or wants to update the specification after client answers, team decisions or a cold review."
---

# POC specification

Produce a specification the client reads as a clear description of the solution they asked for: one coherent text per scenario, merged from all their documents, with every gap made visible and every fact traceable. Write it in the output language; the template is in English.

## Hard constraints

1. No fact without a source. Every statement of the specification has a line in `traceability.md`. The specification itself carries no source citations. A choice made by the team is not a client fact: it goes in the "Team hypotheses" section with an `Hnn` id, never as a requirement.
2. Never resolve a contradiction silently, and never state either side of it as a fact. Where sources disagree, write the affected statement in neutral terms ("attachment to be confirmed", "number to be confirmed", in the output language), add `[TO CLARIFY: <short statement>]`, and record both versions in the "Arbitrations" table of `traceability.md`. The working hypothesis is always the conservative one: do not show a piece of data to a client, do not attach an item to a contract or an owner, do not commit to a flow or a total, until the client confirms. Two sources agreeing against a third is not a confirmation: the conflict stays open. Only the client confirms, directly in a source or as reported by the user.
3. Keep the headings of the template, translated into the output language. Add sections only inside them.

## Writing rules

1. Describe the target solution and its users, never the documents. Forbidden in the specification, in any language: "the document states", "the slide shows", "according to the file", file names of `ingested/`, line numbers.
2. One text per scenario. Merge what every source says about a scenario into a single flow, without duplicate steps. When two sources describe the same step at different levels of detail, keep the detailed one.
3. Each step of a flow: actor, action, visible result. The actor comes from the sources; when they do not name who acts, write the organisation the sources name and add a marker. Concrete data (client, contract, dates) goes in the demonstration case or in the steps, not in commentary.
4. Use a table for 4 fields or more, for a comparison of two views, or for a form. Use numbered lists elsewhere.
5. Keep the client's business vocabulary. Translate column names of exports written in another language into business terms of the output language in the scenario sections; keep them as is in the annex.
6. Scenario titles: short noun phrase in sentence case, built from the client's title.
7. Contradictions and doubts appear in the body only as a `[TO CLARIFY: …]` marker after the statement they affect. No paragraph comparing sources in the body.
8. Never write that something is absent from the sources ("no notification is described", "not specified"). Write what the solution must do and add a marker for what is missing.
9. Keep the strength of the client's words: "help", "possible", "to be imagined" stay a help or an option, never a decision or a commitment; "refresh" is not "replace". "Out of scope" lists only what the client excludes.
10. Never derive a requirement from a conversion artefact (broken accents, Markdown table layout, extraction noise). Requirements come from what the client says or shows.
11. A team decision appears in the body only through its `[Hnn]` reference, after the statement it settles. The reader must always be able to tell what the client asked for from what the team chose.

## Procedure

1. Anchor. Read `poc.yml` at the project root (working root `paths.root`, output language), then `<root>/state.md`. If phase 1 is not recorded as done, stop and suggest the `poc-1-import-documents` skill. Run the `mark` command of the `poc-track-costs` skill with `--phase 2-write-specification`.
2. Choose the mode. If `specification.md` already exists, go to update mode (step 11) when there is at least one input: a question with status `answered` in `questions.md`, a decision with `Report to specification: yes` in `state/decisions.md`, or a correction requested by the user. Otherwise, draft mode. Before rewriting an existing specification or traceability, copy them to `<root>/history/` as the rule on working files says.
3. Read the material. Open every converted file listed in `inventory.json`, including every `embedded/` file linked from a document. Embedded spreadsheets often hold the real test data and file formats.
4. Build a fact list for yourself: fact, source file, passage. It becomes `traceability.md`.
5. Cross-check identifiers. Build an entity matrix for yourself: for each class (clients, actors, contracts, dates, volumes, units, systems), list the values found in each source file. Text from diagrams, mock-ups and example screens counts as a client statement. A value present in one source and absent or different in another is a mismatch. Each mismatch becomes a marker and an "Arbitrations" line. Typical traps:
   1. clients or actors named in a scenario document but absent from the test data, or the reverse;
   2. an operation, a date or a volume attached to a different contract in two files;
   3. totals or counts that differ between a summary and the detailed data;
   4. units that differ between a current file and the target screen;
   5. a requirement described as "possible" or "to be imagined" by the client: mark it as an option, not as a commitment;
   6. the same system, screen or step written with a slightly different name in two places (an acronym differing by one letter, a title that does not match its body text, a translated name);
   7. a statement about what a given client sees, checked against the owner of each row in the detailed data.
   Write the mismatches in `<root>/state/analysis.md` as a table with these columns: Class | Value A (source) | Value B (source) | Neutral wording kept | Conservative hypothesis. This table is mandatory, even when it is empty; the specification must use the neutral wording of each row.
6. Order the scenarios. Keep the scenario numbers of the client document dedicated to the scenarios; if another source numbers them differently, add a marker. Then write a dependency table in `<root>/state/analysis.md` with these columns: Scenario | Does a client sign in and see only their data? (yes/no, with the step) | Does it change or compare a published item? (yes/no, which one) | Depends on | Provided by. Fill the two yes/no columns step by step before filling "Depends on":
   1. a "yes" in the first column means the scenario depends on the accounts and access rights; it comes after the scenario that demonstrates them, even if that scenario has a higher number;
   2. a "yes" in the second column means the scenario comes after the one that publishes that item.
   Present the scenario sections in the order given by the table and explain it in one sentence in section 1.
7. Framing questions. Before writing, ask the user, following the rule on questions and approvals and the "Framing" section of `state.md`:
   1. confirm the scenarios in scope and their order, with the order of the dependency table as the recommended choice;
   2. present the mismatch table and the gaps that block a scenario, and ask which ones the user can already answer from client meetings; then ask one question per item the user names. An answer that reports what the client said is a source: record it in `traceability.md` as "client exchange reported by <user>, <date>" and resolve the item. An opinion of the user is not a client answer: the marker stays;
   3. ask whether the client expects something the documents do not show (a screen, a report, a constraint). Record it as a source the same way, or as a question for the client.
8. Write. Load `assets/specification-template.md` and fill it in the output language, following the writing rules:
   1. "Context": how the client works today and what goes wrong, when the sources describe it.
   2. "Test data": one row per test entity (for example one per client contract), with only the attributes the scenarios rely on.
   3. "Cross-cutting requirements": every requirement found in two scenarios or more (versioning, notifications and language, profiles with the full list of roles, data presentation, units).
   4. "Annex": one subsection per reference file, in the order the scenarios use them. Business name, example name, header, a table with every column of the sample file and one example value, and the conventions (sign of quantities, placeholders, total lines). Name the file for what it actually contains: when the client applies it to several cases but the sample covers only one, say so with a marker.
   5. For each scenario, answer these points in the scenario section, or turn the missing ones into markers: who triggers or publishes, and through which action; what the client is expected to do; each notification (trigger, recipient, channel, content, trace kept); each screen (main or secondary view, columns, filters, sort, totals); where each displayed piece of data comes from; how access rights are enforced (on the server, not only on display); what happens after the outcome (which scenario takes over, whether a published item can still change or needs a new revision).
9. Save `<root>/specification.md` from `assets/specification-template.md` and `<root>/traceability.md` from `assets/traceability-template.md`.
10. Self-check, then go to step 12:
   1. search the specification for the forbidden phrases of writing rule 1, in the output language, and for `ingested`, `.md`, `(source`; rewrite any hit;
   2. check that every client and actor of the entity matrix appears in the specification, in scope or in a marker;
   3. check that no step appears twice in a scenario;
   4. read section 1 and the scenario order: the order matches the dependencies;
   5. for each row of the mismatch table, find the statement in the specification: it uses the neutral wording, carries a marker, and no other sentence (data tables, demonstration cases included) states one side as a fact.
11. Update mode. List the inputs and show them to the user before editing. Then apply them in this order:
   1. client answers: for each question with status `answered`, apply the answer to the referenced sections, remove the `[Qnn]` reference, add a line "client answer Qnn, <date>" in `traceability.md`, then set the status to `integrated`. When an answer is ambiguous or changes a scenario beyond its question, ask the user how to apply it;
   2. team decisions marked `Report to specification: yes`: write each one in "Team hypotheses" with the next `Hnn` id, cite `[Hnn]` where it applies, add a traceability line "decision Dnn", then set the decision to `Report to specification: done <date>`. A decision that answers a client question stays a hypothesis until the client confirms it;
   3. corrections requested by the user or accepted after a cold review: fix the sentences concerned, with a traceability line "review <date>".
   Do not touch other questions or sections. Raise the version number at the top of the document.
12. Cold review and checkpoint. First ask the user whether to run a cold review now (recommended before the specification goes to the client). If yes, launch the `poc-challenger` agent as a sub-agent, never by selecting it in this session: it must read the specification without the context that wrote it. Use the sub-agent tool with the custom agent when it is offered; otherwise give the persona text as instructions and pass explicitly the `model:` of its agent file. Give it the paths of the specification and of `ingested/`, and ask for findings with the quoted passage. Then go through the findings one question per finding: fix now (recommended for a sentence without a source), turn into a client question, or reject with a reason. Apply the fixes as in step 11.3 and record the rejected ones in `state/journal.md`. Then present to the user: the scenarios and their order, the number of markers, the main conservative hypotheses, and in update mode the sections changed. Ask for approval: approve, approve with changes, rework. Apply the requested changes within the hard constraints, run the self-check of step 10 again, then ask again. If the request already approves the specification, record it as pre-approved. Once approved, record the approval of the specification with `--step 2-write-specification` (see "Deliverable approvals" in the `poc-0-start` skill).
13. Record, following the rule on working files: a phase 2 block in `state/journal.md` (date, version, scenario order, number of markers, team hypotheses, sections updated, answers reported by the user, approval) and the phase 2 row of "Progress".
14. Anchor check. Re-read the three hard constraints. Confirm that no data from another client project was reused.

## Next step

If the document contains `[TO CLARIFY: …]` markers, suggest the `poc-3-ask-client` skill. If the cold review was skipped, suggest it before the specification is shared with the client: it runs from this skill, as a sub-agent. Once the specification is validated, suggest the `poc-4-plan-scenario` skill with the `poc-architect` agent, for the first scenario of the dependency order, in a new Copilot session (recommended), or as a new request in this session.
