---
name: poc-3-ask-client
description: "Build and track the list of questions to send to the client during a pre-sales POC: contradictions between documents, missing information, ambiguous rules, each with a priority and a working hypothesis. Use when the user asks what to clarify with the client, prepares a meeting or an email to the client, or brings back client answers to record, in any format."
---

# POC client questions

Turn every gap and contradiction into a precise question the client can answer quickly, with a working hypothesis so the POC keeps moving.

## Hard constraints

1. Never mark a question as sent, and never send anything, without the user's explicit decision.
2. Never renumber existing questions. New questions take the next free number.
3. In `specification.md`, the only allowed edits are replacing a `[TO CLARIFY: …]` marker by its `[Qnn]` reference and updating the "Questions and remarks" section.

## Mode A: build or refresh the list

1. Anchor. Read `poc.yml` at the project root (working root `paths.root`), then `state.md`, `specification.md` and `questions.md` if they exist in the working root. If there is no specification yet, work from the ingested sources only and say so. Run the `mark` command of the `poc-track-costs` skill with `--phase 3-ask-client`.
2. Collect. List every `[TO CLARIFY: …]` marker of the specification (and every legacy `[A CLARIFIER` marker).
3. Independent pass. Re-read the ingested sources, embedded files included, and look for contradictions the specification missed: names of clients and actors, contract codes, dates, volumes, units, systems (including names that differ by one letter, or a step title that does not match its text), owners of each action, and which client owns each row of the detailed data. A finding counts only if two passages can be quoted against each other, or if a scenario cannot be demonstrated without the missing information.
4. Build pass. For each scenario of the specification, ask what the team needs to build and demonstrate it that no source gives. Write a coverage matrix in `<root>/state/coverage.md`, one row per scenario, one column per item below, and fill every cell with `covered` (the sources answer it), `Qnn` (the question that covers it) or `n/a` (with a reason of a few words). An empty cell is not allowed. Items:
   1. interfaces: for each external system, access (address, authentication, test account), file naming, frequency, data model, channel;
   2. publication: who publishes or triggers, and what the client is expected to do afterwards;
   3. notifications: for each one, trigger, recipients (including on-call or back-office staff), channel (mail, portal or both), content, language;
   4. roles: rights of every profile named in the sources, not only the main ones, including what each one may modify;
   5. workflows: one loop or repeatable loops, who declares a version final, how a version is identified, whether a published item can be modified or needs a new revision, participants chosen each time or from a default list;
   6. variants: for every document type or case the client lists next to the main one, does it follow the same template and flow;
   7. data origin: which system provides each piece of data shown on screen, and how availabilities or capacities are established;
   8. units: one unit or a conversion, when the sources mix units;
   9. options: for every feature the client calls possible or to be imagined, is it in the POC or later;
   10. screens: which view is the main one when several are described.
   A question counts only if the answer changes what is built or demonstrated. There is no quota. Cell rules:
   1. `n/a` is allowed only when the item cannot exist in the scenario (no external system, nothing published). "Not described in the sources" is never a reason for `n/a`: it is a gap, and becomes a question when the answer changes the build. When something is published, sent or changed for someone, ask whether a notification is expected.
   2. `covered` must be followed by a few quoted words from the source that answers it.
   3. For items with several sub-points (interfaces, notifications, workflows), write one entry per sub-point in the cell, for example `loops: Q12; final version: Q13; change after publication: Q14`. A question may cover only one sub-point.
5. Filter. Drop any question the sources already answer. Merge duplicates. Split compound questions.
6. Write each question:
   1. one topic, closed or precise, not leading;
   2. context quoting what each source says, with file and section;
   3. impact on the POC if not resolved;
   4. a working hypothesis the team can apply meanwhile; for a contradiction, the conservative one (show nothing to a client, attach nothing to a contract, commit to nothing until confirmed);
   5. a priority: `blocking` when a scenario cannot be demonstrated without the answer, `important` when the answer changes what is built but the hypothesis lets the team move on, `minor` for a detail of presentation or format. Use `blocking` sparingly: if more than a fifth of the questions are blocking, review them.
7. Number. Keep existing `Qnn` identifiers. Give new questions the next free number. Group by scenario, in the order of the scenario sections of the specification, plus a "Cross-cutting" group.
8. Link. Replace each processed marker in `specification.md` by `[Qnn]`. Update the "Questions and remarks" section of the specification with the one-line text of every question, including those without a marker.
9. Save `<root>/questions.md` from `assets/questions-template.md`, with status `to-send` for new questions. Write the questions in the output language; status and priority codes stay as they are. Update the summary table, by priority and status.
10. Checkpoint. Present the new questions grouped by priority, blocking ones first, with their count. Recommend a first sending limited to the blocking questions, then the important ones; a client who receives dozens of questions answers the easy ones first. Ask which ones go to the client and through which channel. Wait for the answer. If the request already says which questions are sent, or that none is sent yet, apply it without asking. Then set the chosen questions to `sent` with the date, and the rejected ones to `dropped` with the reason. Record the approval of `questions.md` with `--step 3-ask-client` and the channel as comment (see "Deliverable approvals" in the `poc-0-start` skill).
11. Record, following the rule on working files: a block in `state/journal.md` (questions per status and per priority, date of the last sending) and the phase 3 row of "Progress".

## Mode B: record client answers

Client answers often come in the client's own format: an email, a spreadsheet, a meeting report, a list of questions from several suppliers. Match them to our questions instead of asking the client to use our numbers.

1. Anchor. Read `state.md` and `questions.md`. Run the `mark` command of the `poc-track-costs` skill with `--phase 3-ask-client`. If the answers arrived as a file, check that `poc-1-import-documents` converted it, or suggest it first.
2. Ask the user, if not stated, whether our questions were sent to the client, when and how, and whether the received document answers them or other questions (another supplier, a general list).
3. Match. For each piece of the client's text, find the question it answers, and classify it. Show the classification to the user in one table before writing anything:
   1. `direct`: the client answers the question itself; quote the client's words;
   2. `deduction`: the answer is inferred from a text written for another purpose (another question, an example, a general statement); give the quoted words and what is inferred;
   3. `off-topic`: the text answers another topic; the question stays open;
   4. `reference`: the client refers to a document not received ("see the file…", "it is in the requirements document"); add a question asking for the document;
   5. `new information`: the text adds a fact no question asked about, or contradicts a working hypothesis or the specification; add a question when it creates a contradiction, otherwise list it for the specification.
   A hesitant answer ("I think", "under construction", "we stay open") is never `direct`: classify it as `deduction` or keep the question open.
4. Validate the deductions with the user, one question per deduction: validate, reject (the question stays open), or validate with a correction. A validated deduction is recorded as "deduction validated by <user> on <date>", in the output language. It is a team decision, not a client answer: record it in `state/decisions.md` with `Report to specification: yes`, so that the specification shows it as a team hypothesis.
5. Record. For each `direct` answer and each validated deduction, fill the "Answer" column with the client's words, the date, the channel and the nature, and set the status to `answered`. Questions without an answer keep their status, or become `sent` with the sending date the user gave. New questions take the next free numbers and a priority. Update the summary table.
6. List in `state/journal.md` the specification sections affected by the answers, the new information, and the documents to request.
7. Suggest running the `poc-2-write-specification` skill in update mode.

## Anchor check

Before finishing either mode, re-read the three hard constraints and confirm that none was broken. Check that each question covers one topic only: in the coverage matrix, each `Qnn` may appear in one sub-point only. Split any question that appears in several sub-points or mixes two contradictions, then update the matrix.
