---
name: demo-0-start
description: "Configure a kit-demo project: create or check demo.yml. Use when the user starts a demo project or asks how to configure it. Fictional kit used to show and test the Vibe Studio."
---

# Demo start

1. Look for `demo.yml` at the project root. If it is missing, copy `assets/demo-template.yml` and ask the user, one question at a time with the `ask_user` tool, for the project name and the output language.
2. Never overwrite an existing value without the user's confirmation.
3. When the launch context gives an Vibe Studio run id, call `vibe_studio_report` with `status: started` after loading this skill, and with `status: produced` and `paths: ["demo.yml"]` at the end.
4. Name the next step: `demo-1-write-note`.

## Deliverable approvals

Approvals are recorded in `<paths.root>/approvals.md` with `python <this skill folder>/scripts/validations.py record --project . --file <paths.root>/approvals.md --language <project.language> --path <deliverable> --step <step id>`, only when the user approves.
