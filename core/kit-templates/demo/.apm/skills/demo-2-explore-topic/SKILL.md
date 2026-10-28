---
name: demo-2-explore-topic
description: "Explore one topic of the kit-demo scoping note: split it into tasks, work through them one at a time and write the findings. Use when the note is approved and the user picks a topic. Fictional kit used to show and test the Vibe Studio."
---

# Topic exploration

1. Read `<paths.root>/note.md` and the topic number given by the launch context or the user.
2. Create `<paths.root>/topics/topic-<n>/tasks.md` from `assets/tasks-template.md` with three tasks `T01` to `T03`, each one line.
3. For each task, in order: mark it in progress (with `vibe_studio_report` and `task: {id, status: in_progress}` when the launch context gives a run id, otherwise set `[~]` yourself), do it, then mark it done. One task at a time.
4. Write `<paths.root>/topics/topic-<n>/findings.md`: one paragraph per task.
5. Checkpoint: ask the user to approve the findings. Once approved, record the approval with the validations script of `demo-0-start`, `--step 2-explore-topic`.
6. Report the end with `vibe_studio_report`, `status: produced`, and the paths written.
