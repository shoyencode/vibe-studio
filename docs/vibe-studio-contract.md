# Vibe Studio kit contract (protocol 2)

A kit tells Vibe Studio how to drive it with one file, `vibe-studio.json`, shipped in its entry skill (`<skill>/assets/vibe-studio.json`). APM installs it with the skills, so the contract always matches the installed kit. Vibe Studio owns the public schema in `core/schema/vibe-studio.schema.json`; kits implement it independently. Reference fixtures: `test/fixtures/reference-kit` and `test/fixtures/demo`. No sibling repository is required.

Vibe Studio finds the kit by scanning the supported skill folders for `*/assets/vibe-studio.json`: `.agents/skills`, `.apm/skills`, `.claude/skills` and `.gemini/skills`. It drives one kit per project; several kits give a clear error. The contract must use protocol 2. Missing current contracts and unsupported versions are refused, not converted. Kit versions come from matching APM metadata when available; no external repository is read.

## Blocks

| Block | Required | Role |
| --- | --- | --- |
| `protocolVersion` | yes | `2` |
| `kit` | yes | `id` (package name in `apm.yml`), `name`, `description`, `about` (optional Markdown presentation shown in the About space), `entrySkill`, `i18n` |
| `config` | yes | configuration file at the project root, its schema and template (relative to the entry skill), JSON pointers to the language, the title and the path object, placeholders |
| `units` | when a step has scope `unit` | working unit repeated in the project: `id`, `label`, `plural`, `folder` with `{n}` in its last segment, `evidence` folder |
| `steps` | yes | the journey, in order |
| `deliverables` | no | groups shown in Deliverables (`patterns`, `*` one segment, `**` any depth) and `extra` files listed even when no step produces them |
| `modules` | no | optional functions, each with its own format (below) |
| `guards` | no | rules imposed on the tools of the AI in the sessions of Vibe Studio (below); permanent at the root, per step in a step |

## Optional launch policies

`modelPolicies` declares `default`, `agents` (keyed by agent name) and `steps` (keyed by existing step id).
Each policy has `default` and `models` (one to three distinct identifiers; the default must be a candidate).
Step policy takes precedence over agent policy, then kit default. Without a policy, the historical scalar
agent model and application default remain supported. Keep agent frontmatter `model` scalar for native CLI compatibility.

```json
{
  "modelPolicies": {
    "default": { "default": "claude-sonnet-5.5", "models": ["claude-sonnet-5.5", "gpt-5.3-codex"] },
    "agents": {
      "demo-writer": { "default": "gpt-6-luna", "models": ["gpt-6-luna", "claude-haiku-4.5"] }
    }
  }
}
```

Policies may declare `byProducerFamily`, keyed by `openai`, `anthropic`, `google` or `unknown`, with
`default`/`models` alternatives for cross-family reviewers. Use the actual production model/provenance
passed at launch; never infer authorship from an agent's configured default. If provenance is missing,
request it rather than claiming an independent review.

The user chooses from the policy's models compatible with the selected engine. Free conversations are not
restricted to this shortlist. Standard/extended context depends on known engine/model capabilities, not
arbitrary token counts. Selections are validated again before launch and recorded without rewriting agent files.

Copilot keeps its last successful catalog per account/endpoint in the local profile. When listing fails, the UI
identifies the cached catalog and permits retry; authentication/session errors are not hidden. On first use without
a cache, kit-declared models alone are offered as unverified; no arbitrary identifier entry or invented extended
context is provided.

## Optional unit catalog

Add `units.catalog: { "script": "demo-0-start/scripts/list_units.py" }` to discover all intended units,
not only folders already created. The script belongs to the installed kit, relative to its skills directory.
Vibe Studio invokes Python without a shell, with `--project <absolute-project>` and JSON on standard input:

```json
{ "config": {}, "placeholders": { "root": "work", "specification": "work/specification.md" } }
```

The kit reads its own specification format and writes JSON on standard output, without modifying the project:

```json
{ "units": [{ "id": 2, "title": "Pricing" }, { "id": 5, "title": "Customer access", "dependsOn": [2] }] }
```

IDs are unique positive integers, independent of list position. Titles are nonempty business titles, without
numeric scenario prefixes. Dependencies reference declared IDs and must be acyclic. Output is bounded to 500
units and 2 MB, with a ten-second execution limit. A provider failure or invalid response is an explicit error,
not an empty successful catalog. Report provider errors as JSON on stderr and exit nonzero.

Declared units are merged with existing folders. Selecting unit 5 does not require folder 4; its own required
files and approvals still apply. The provider must not create plans, catalog files, bytecode or migrations.
Contracts without this declaration keep folder-based discovery. A kit update can supply a read-only reader
for existing specifications; Vibe Studio never parses a named kit's Markdown or rewrites client projects.

These protocol-2 extensions are optional for new readers of old contracts. Older strict validators, including
Vibe Studio 1.0.0, reject unknown fields: update the application/schema before deploying an enriched kit.
Kits keep an explicit copy/version of the public schema, never a sibling-repository runtime import.

## Placeholders

A path pattern may use `{name}` for each entry of `config.placeholders` (value read at its JSON pointer, or its default), `{unit}` for the folder of the unit and `{n}` for its number. Paths stay inside the project: the values of the `config.paths` object are checked before any path is followed.

## Steps

| Field | Meaning |
| --- | --- |
| `id` | `<number>-<name>`, unique |
| `skill`, `agent` | skill run by the step; custom agent selected for it, or `null` |
| `scope` | `project`, or `unit` (run once per unit) |
| `configures` | the step creates or edits the configuration: Vibe Studio opens the configuration form first |
| `requires`, `outputs` | files needed before launch; files produced |
| `approves` | deliverables approved by the user at the checkpoint of the step (module `approvals`) |
| `requiresBuiltUnit` | at least one unit has evidence |
| `contextTier` | `long_context` asks the long context window of the model |
| `summary`, `returns`, `i18n` | texts shown before launch |
| `variants` | texts of the step when the module `review` changes its purpose (`corrections`, `rereview`) |

## Modules

| Module | Fields | Format the kit follows |
| --- | --- | --- |
| `tasks` | `file`, `buildStep`, `requirements` | Markdown task list: `Plan status: <text>` (approved when it starts with "approved"), `## ` sections, lines `- [ ] T01 …` with markers `[ ]` `[~]` `[x]` `[!]`, ids `T`, corrections `R`. Vibe Studio writes the marker when the agent reports a task. `requirements` points to a contract whose table rows start with `AC1`, `BR1`, `UI1`, `IF1`. |
| `review` | `file`, `buildStep`, `reviewStep`, `feedback` | review rounds: `Review round: <k>`, `Corrections reviewed: R01, R02`, a `## Findings` table of `R` ids; previous rounds archived as `<file>-<k>.md`. With `feedback`, the user adds R tasks in a `## Review corrections` section. |
| `sources` | `folder`, `inventory`, `importStep` | client documents; JSON inventory with `sources[].converted` Markdown paths |
| `costs` | `script`, `report`, `budget`, `creditsPerAiu` | script with the `report --json --read-only` and `mark` commands of `poc-track-costs` |
| `approvals` | `script`, `file` | kit-owned script with `record`, `status` and `reopen`, taking `--file` and `--language` (as in `poc-0-start/scripts/validations.py`). Reopening appends revocations; it does not remove previous approvals or documents. |
| `application` | `pointer` | configuration object `{ services: [{ name, cwd, command, port, url }], open }` started in order by Vibe Studio |

Scripts are relative to the skills folder of the project. They write JSON on standard output, and on error a JSON object `{ code, error }` on standard error with exit code 1.

## Guards

Vibe Studio imposes the guards by hooks of the harness in the sessions it creates, instead of asking the AI to follow them. A blocked action is refused before it runs and the AI receives the `reason`. A guard never approves anything: the permissions of the user stay in force. Reads are never blocked.

Each entry has an `id` (`G` and two digits, `E` and a number for end checks), a `reason` sent to the AI (start it with "Vibe Studio guard <id>:" and say what to do instead), an optional `description` shown to the user, and `i18n`. Paths are patterns with placeholders, relative to the project.

| Kind | Fields | Effect |
| --- | --- | --- |
| `readOnly` | `paths`, `except` | no file tool and no shell command writes these paths |
| `scriptOnly` | `paths`, `scripts` | only a shell command naming one of the scripts writes these paths |
| `forbidCreate` | `paths`, `except` | no new file matching the paths; existing files stay editable |
| `requireTaskInProgress` | `paths` | writing these paths needs a task `[~]` in the task list of the unit (module `tasks`) |
| `singleTaskInProgress` | | `vibe_studio_report` refuses a second task in progress |
| `secrets` | | no written content that looks like a token, a private key or a password |
| `confirmCommands` | `commands` | shell commands matching these regular expressions are confirmed by the user |
| `skills` | `skills` | the skills of the other steps are refused, except those listed |
| `subagentsReadOnly` | | sub-agents of the step only read |
| `history` | `paths`, `except`, `folder` | before a file of the paths is rewritten in full, a copy `<name>-v<n>` goes to the folder |
| `end` | list of `{ id, check, path }` | checked when the AI ends its turn: `reported` (a final report), `noTaskInProgress`, `modified` (the file changed during the step), `planStatus`, `reviewDecided` (each finding of the review has a decision). A failed check sends the AI back with the reasons, twice at most; then the user is alerted. |

Detection of shell writes is best effort: it reads common write commands and redirections. The rule of the kit also tells the AI that a refusal is final. The user sees the rules, the blocked actions and the end checks in Settings › Guards, and can suspend a guard until the end of the step; each change is kept in the journal. Sessions opened outside Vibe Studio are not guarded.

## Report tool

During a launched step Vibe Studio offers the tool `vibe_studio_report` (`runId`, `status` among `started`, `waiting`, `produced`, `error`, optional `paths` and `task: { id, status }`). Agents with a closed tool list receive it automatically. Kits mention it in their skills; it never stands for an approval of the user.

## Compatibility

The protocol version changes only on a breaking change. New optional fields and modules keep version 2: Vibe Studio ignores what it does not know, and a kit must not rely on an optional block that its target application version does not read.

Contracts use `vibe-studio.json`, the `vibe_studio_report` tool and the `vibe_studio` MCP namespace.
The application does not adapt other filenames, renamed agent tools, event namespaces or protocol-1 catalogs.
Update the installed kit before using it. No client file, user message, external journal or application profile
is rewritten or imported automatically.
