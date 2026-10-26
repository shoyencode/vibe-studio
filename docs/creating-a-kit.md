# Creating a kit for Vibe Studio

A kit is an APM package of skills, agents and rules for one kind of mission (pre-sales POC, audit, migration…), plus a contract that lets Vibe Studio drive it. The demo kit (`test/fixtures/demo`) is the smallest complete example: copy it, then follow these steps. A kit does not include the application or require a sibling checkout.

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
