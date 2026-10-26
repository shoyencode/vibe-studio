---
name: poc-1-import-documents
description: "Convert and inventory client documents (PDF, Word, Excel, PowerPoint, emails, notes) received for a pre-sales POC into Markdown the agent can read. Use when the user drops client files, says 'here are the documents', asks to analyze, read or summarize client material, or before writing a POC specification. Uses pocdoc, the converter shipped with the kit, which also converts the Excel files embedded in Word documents and keeps PDF tables aligned."
---

# POC ingestion

Turn raw client files into readable Markdown plus an inventory, so later stages work from facts on disk instead of guesses.

## Hard constraints

1. Never modify the client files in the sources folder.
2. Never convert a file by reasoning or describe content that the script did not extract.
3. Never continue to the specification before the user confirms the inventory.

## Procedure

1. Anchor. Read `poc.yml` at the project root: `paths.root` is the working root and `paths.sources` the sources folder. Without `poc.yml`, suggest the `poc-0-start` skill, or use the folders given in the request, proposing `poc/sources/` and `poc/`. Read `<root>/state.md` if it exists. Then run the `mark` command of the `poc-track-costs` skill with `--phase 1-import-documents`.
2. Check the tool. The converter `pocdoc` ships with this skill (`scripts/pocdoc/`) and uses the Python standard library. When the sources contain PDF files, run `python -c "import pypdf"`; if it fails, tell the user to run `pip install pypdf` (license BSD-3-Clause) and stop.
3. Convert. Run, from the repository root:
   `python <this skill folder>/scripts/ingest.py --sources <sources> --out <root>`
   The script prints a JSON inventory on stdout and writes `<root>/inventory.json`, `<root>/ingested/*.md` and `<root>/ingested/embedded/*.md`. Diagnostics on stderr are not errors. Run `--help` if unsure of the options.
4. Report. Show the user one table: file, type, converted characters, embedded objects, warnings. Then list what each warning means:
   1. `near-empty conversion`: scanned PDF or nearly empty file. Ask for a text version or accept the gap.
   2. `image(s) not extracted`: diagrams or screenshots. Ask the user whether they carry information that must be described by hand.
   3. `unsupported type`, an old format to save again (`.doc`, `.ppt`, `.msg`: the warning says which format to use) or `conversion error`: file ignored. Ask for another format.
   4. `page(s) without text, probably scanned`: the listed PDF pages hold images only. Ask for a text version or a description.
   5. `page(s) laid out as tables`: those PDF pages are kept as aligned text in a code block, so that each value stays under its column. Nothing to do.
5. Checkpoint. Ask the user to confirm that the inventory is complete and how to handle each warning. Wait for the answer. If the request already approves the inventory, record it as pre-approved and continue. Record the approval of `<root>/inventory.json` with `--step 1-import-documents` (see "Deliverable approvals" in the `poc-0-start` skill).
6. Record, following the rule on working files: a block "Phase 1: import" in `<root>/state/journal.md` (date, sources folder, working root, number of files, warnings and the decision taken for each), the phase 1 row of "Progress" in `<root>/state.md`, and each missing document as an open point.
7. Anchor check. Re-read the three hard constraints and confirm none was broken before handing over.

## Output contract

1. `<root>/ingested/<name>.md`: one file per source. Embedded Excel objects appear at their original position as a quoted link to `embedded/<name>__objN.md` with the list of sheets.
2. `<root>/inventory.json`: `sources[]` with `path`, `type`, `converted`, `chars`, `embedded[]`, `warnings[]`, plus `errors[]`.
3. `<root>/state/journal.md`: phase 1 block; `<root>/state.md`: progress row.

Re-running the script overwrites `inventory.json` and files of the same name in `ingested/`; delete `ingested/` first to drop files removed from the sources. It never touches `sources/`.

## Next step

Suggest the `poc-2-write-specification` skill once the checkpoint is passed, in a new Copilot session (recommended), or as a new request in this session.
