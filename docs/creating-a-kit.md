# Creating a kit for Vibe Studio

A kit is an APM package of skills, agents and rules for one kind of mission (pre-sales POC, audit, migration…), plus a contract that lets Vibe Studio drive it. The demo kit (`test/fixtures/demo`) is the smallest complete example: copy it, then follow these steps. A kit does not include the application or require a sibling checkout.

## Kit workshop in the application

Use the project button to return to Home without closing the project. The sidebar offers **Projects**,
**Kit workshop** and **Official kits**; **Close project** disconnects idle conversations without changing
project files.

### Create a kit from a mission

In **Kit workshop**, give the kit a name and describe its mission as you would to a colleague: goal, expected
course, people involved, documents the user approves. Examples (proof of concept, audit, migration) fill in a
starting mission. Options let you attach reference documents for the first draft (they are not copied into
the kit), choose the writing language and the kit folder (by default `Documents\Vibe Studio\Kits\<name>`).
Identifiers, skill names, folders and the project configuration step are generated: no technical choice is
required. **Create without the AI** creates the same starting kit without a draft.

**Prepare the draft** sends the mission to the AI harness selected in Settings, with the model shown under the
form. The AI only reads the kit: it cannot write files or run commands. It publishes a short task list and
submits structured proposals: kit presentation, steps with their documents, repetition and approvals, step
instructions, safety rules. Each proposal is checked against the kit before it is queued. Questions from the
AI appear on the preparation screen; Pause and Resume keep the same session.

### Review the proposals

Nothing enters the kit before review. Proposals are shown one at a time with a before/after comparison and the
kit taking shape alongside. **Accept**, **Edit** then accept, **Reject**, or **Ask for another proposal**.
Accepted proposals are saved immediately and keep the kit valid; rejected ones are not applied. **Finish
later** keeps pending proposals; a banner in the kit brings them back. The summary counts accepted and rejected
proposals, lists texts still to translate and reports the kit check.

### Refine the kit

The kit view has an outline (presentation and languages, then the journey) and one plain page per step: title,
what the step does, expected result, documents used and produced, repetition for each repeated element, user
approval and instructions for the AI. Edits are saved when a field is left. **Ask the AI to improve this
step** opens a new review round for that step. When the kit check reports problems, **Fix with the AI**
proposes the smallest corrections.

### Languages

Texts are written once in the writing language. Other kit languages are translated by the AI, then reviewed
side by side text by text: validate, edit or skip. A translation becomes "to update" when its source text
changes. Instructions for the AI stay in the writing language; the project AI answers in the project's
language. The header language selector previews the kit as users of another language will see it.

### Expert mode

**Expert** adds the technical settings: step identifiers, skills, agents, scope, required and produced files,
step rules and end checks, project configuration, deliverables, modules, safety rules and model policies,
plus the raw `vibe-studio.json` with a live check. Nothing invalid is saved. Authoring metadata is kept in
`.apm/vibe-studio-authoring.json`: it travels with ZIP exports but is never installed into projects.

### Test and share

**Test in a project** installs a validated copy into a chosen project, then opens it. **Share** (in the ⋯
menu) exports a ZIP or proposes the kit to the official catalog. Open an existing kit folder, import a ZIP or a
Git repository from the start screen; recent kits stay listed there. Git imports require Git; repository
authentication remains in the existing Git environment. Git commits and pushes to internal repositories remain
outside Vibe Studio. Official publication and update behavior are documented in [Kit catalog](kit-catalog.md).

Hooks that keep the AI read-only are guardrails, not an operating-system sandbox. Review generated instructions
before using or sharing a kit; do not place credentials or client data in it.

## 1. Package

1. `apm.yml` at the root of the kit: `name` (the kit id), `version`, `description`, `license`, dependencies.
2. Skills under `.apm/skills/<skill>/SKILL.md`, agents under `.apm/agents/<agent>.agent.md`, rules under `.apm/instructions/`. Use the APM front-matter format.
3. One entry skill configures the project. It holds `assets/vibe-studio.json`, the schema and the template of the configuration file.
4. Declare an available model in the agent front matter. The kit manages its model choices independently; Vibe Studio does not require a particular model catalog or generation script.

## 2. Contract

Write `assets/vibe-studio.json` (see `docs/vibe-studio-contract.md`):

1. `kit`, then `config`: configuration file, schema, template, pointers to the language, the title and the paths, placeholders.
2. `units` if a step repeats per unit of work (scenario, topic, batch).
3. `steps` in journey order. The first one usually has `configures: true`.
4. `deliverables` groups for the Deliverables view.
5. Only the `modules` the kit really uses. Follow the formats documented in the contract (task lists, review rounds), or leave the module out.

Validate it against `core/schema/vibe-studio.schema.json`. `npm run test:bridge` validates both bundled reference contracts and their shipped assets; add your kit the same way. The supported filename is `vibe-studio.json` with protocol version 2.

For selectable AI models, generate `modelPolicies` from the kit's own model routing source, preserving scalar
agent defaults. Provide two or three candidates per profile and opposite-family review choices where needed.
For scenarios declared before their folders exist, ship a read-only `units.catalog.script` that returns stable
IDs and business titles from the specification. See the optional contract sections for both JSON interfaces.
Migrate these sources in the kit repository; do not create a client-project migration or require an AI step to
rewrite existing specifications. Update strict consumer schemas before deploying these optional fields.

## 3. Skills that cooperate with Vibe Studio

1. When the launch context gives a run id, call the compatible `vibe_studio_report` tool after loading the skill, before each question, at each task status change, and at the end with the paths written.
2. Ask with `ask_user`, one question per call. Never treat a report as an approval.
3. At a checkpoint, once the user approves, record it with the approval script (`record --file … --language …`).
4. Stop at the end of the step and name the next one.

## 4. Try it

1. Install the kit in a test folder with APM (`apm install` with the kit as a path dependency), or copy `.apm/skills` to `.agents/skills` and `.apm/agents` to `.github/agents`.
2. Open the folder in Vibe Studio: the journey, units and deliverables come from the contract.
3. In the application repository, run its engine and bridge tests against the reference kit fixtures, with a fake harness first, then one real step. Export or install a pinned kit version for those fixtures; do not make either repository depend on a sibling checkout.
