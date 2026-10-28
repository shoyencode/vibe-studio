---
name: demo-1-write-note
description: "Write the one-page scoping note of a kit-demo project, with three to five topics. Use when the demo project is configured and the user asks for the scoping note. Fictional kit used to show and test the Vibe Studio."
---

# Scoping note

1. Read `demo.yml`. Ask the user, with `ask_user`, for the subject of the note.
2. Write `<paths.root>/note.md`: a title, a context paragraph, and a numbered list of three to five topics, one line each.
3. Checkpoint: ask the user to approve the note (approve, approve with changes, rework). Apply the changes, then ask again.
4. Once approved, record the approval with the validations script of `demo-0-start` (section "Deliverable approvals"), `--step 1-write-note`.
5. When the launch context gives an Vibe Studio run id, call `vibe_studio_report` at the start, before each question and at the end with `status: produced` and the paths written.
6. Name the next step: `demo-2-explore-topic`, one topic at a time.
