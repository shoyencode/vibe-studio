# Vibe Studio

Vibe Studio is a standalone Electron desktop application that drives AI kits on top of a harness. A kit (skills, agents, rules) describes its journey in a contract, `vibe-studio.json`; Vibe Studio reads it, launches each step in a new session of the harness, follows the tasks, shows the deliverables and their approvals, the costs and the application built. Choose Copilot CLI, Claude Code, Codex CLI or Gemini CLI in Settings.

| Folder | Content |
| --- | --- |
| `core/` | Interface-independent core: kit contract schema (`schema/`), Python bridge reading a project from its contract (`bridge.py`), project controller (`project.mjs`), guards engine (`guards.mjs`), launch prompt and report tool (`prompt.mjs`), journal (`store.mjs`), application runner (`runner.mjs`), Markdown renderer, translations |
| `core/adapters/` | Harness adapters. `copilot.mjs` opens one Copilot session per step with the project agents, skills and MCP servers passed explicitly, and maps permissions and questions to the interface |
| `app/` | Desktop application (Electron): main process (`main.mjs`), conversation journal, local profile and window (`renderer/`) |
| `scripts/package.mjs`, `scripts/installer/` | Build the portable version and Windows installer |
| `test/` | Node and Python tests using bundled, MIT-licensed reference-kit fixtures (`test/fixtures`), fake harnesses and fake SDK clients |

Documentation: `docs/vibe-studio-contract.md` (the contract) and `docs/creating-a-kit.md` (writing a kit).

**Kit workshop:** the Home sidebar offers Projects, Kit workshop and Official kits. Describe a mission: the
configured AI harness drafts a complete kit as proposals that the author accepts, edits or rejects one at a
time. Steps are edited on plain pages, kit texts are written once and translated by the AI with side-by-side
review, and an Expert mode exposes the technical contract. Test a kit in a project, share it as a ZIP or
import ZIP packages and Git repositories. The project button returns home; Close project disconnects idle
conversations without changing project files. See [Creating a kit](docs/creating-a-kit.md).
The optional official catalog distributes manually reviewed kits and verified patch updates; see
[Kit catalog](docs/kit-catalog.md) and `catalog-template/` for its separately published repository setup.

## Use

**Windows installer:** run `Vibe Studio-Setup-<version>-x64.exe` on Windows 10 22H2 or Windows 11 x64. It installs for the current user without administrator rights and includes Electron, the Copilot runtime, private Python with `pyyaml`/`jsonschema`, and the MIT-licensed GitHub CLI for personal sign-in. No system Python or Node.js is required. Select **Offline application only** to install the base without downloads.

Git (including Git Bash) and Microsoft APM are optional and checked by default. Claude Code, Codex and Gemini are unchecked options. Compatible tools on the PATH are reused; missing tools are downloaded, verified and installed privately. Gemini includes private Node.js when needed; Claude requires Git Bash and APM requires Git. These options need Internet. Re-run the installer to add tools; deselecting an existing tool does not remove it. Windows PATH, existing tools, project files and personal accounts are not modified.

The branded Windows assistant follows the system's light/dark appearance, supports French and English, and keeps native keyboard navigation and high-contrast behavior. It presents component roles, a review of your choices, live tool-preparation phases and an integrated completion summary. Download percentages measure the current file only when its size is known; other operations remain indeterminate. Failed preparation never becomes a successful installation.

Open **Vibe Studio tools** from the Start menu for commands with the private tools, then sign in with `gh auth login` for Copilot, `claude auth login`, `codex login`, or `gemini`. Existing Copilot sign-ins also work. Installation does not sign in, buy subscriptions or deploy kits. Use `cd <project>` and `apm install` to prepare a project's kit separately. The installation result is saved in `setup\installation-result.txt` under the installed application.

Verified external tool directories are recorded privately, so Start menu launches do not depend on the installer terminal's PATH. Reuse requires the tested major version (also the tested minor version before 1.0); incompatible tools are left untouched and replaced only inside Vibe Studio's private environment.

**Portable/development requirements:** Python 3.11+ with `pyyaml` and `jsonschema`, and a Copilot sign-in (`copilot login`, `gh auth login`, or the GitHub Copilot app).

1. Start **Vibe Studio** from the Start menu after installation, `Vibe Studio.exe` of the portable version, or `npm start` in this folder during development (`npm install` first).
2. **Projects**: open the folder of a project where a kit is installed with APM. The last projects are kept.
3. **Journey**: prepare a step, check what it does, the agent, the model and the context window, add attachments if needed (screenshots, documents: they are copied into the project, in the folder of the unit or of the working root, and given to the AI), then confirm. Vibe Studio opens a new Copilot session for the step and shows it in **Conversation**.
4. **Conversation**: follow the messages and the tools of the AI, answer its questions and permissions (allow once, allow for the step, refuse with a reason), add a message, or stop the step. When the AI waits, a notice and a mark on Conversation say so wherever you are. A short tone marks a question, a permission and the end of a step; when the window is not in front, a Windows notification opens the conversation on click (Settings › Alerts). The portable version adds a `Vibe Studio` shortcut to the Start menu of the user, with AUMID `VibeStudio.Desktop`: Windows shows the notifications of an application that is not installed only through such a shortcut.
5. **Free conversation and permissions**: in Conversation, *New conversation* opens a session in the project outside the journey (agent and model chosen, permanent guards applied, no step and no report). The *Autopilot* switch applies to every session while it is on: tools are allowed and questions answered without the user, except the confirmations imposed by the guards; the AI is told never to record an approval on behalf of the user. When Autopilot is off, *Approve All* allows tools automatically while leaving questions to the user. Both choices preserve guard refusals and required confirmations. Enabling tool approval also releases pending permissions, except guard confirmations.
6. **Guards**: the rules of the kit are imposed on the AI. A blocked action shows in Conversation and in the running step's register entry. Settings › Guards lists the rules, the blocked actions and the end-of-step checks, and suspends a guard until the end of the step when the user decides so.
7. **Settings**: the gear in the left sidebar opens *Personal settings*: Appearance (light, dark or system theme), Alerts (sounds and Windows notifications) and Harness (the agent runtime, see below), even without an open project. These preferences and the conversation switches live in `%APPDATA%\Vibe Studio\preferences.json`, never in the project. When a kit is open, *Project and kit* contains the project configuration, guards and kit information. The versions of the kit and of Vibe Studio are shown under Refresh.
8. **About**: what the kit is and does (its description, its `about` text and its journey), and what Vibe Studio adds.
9. The other spaces come from the kit contract: units (for example, scenarios) with their task tracking, application, deliverables and approvals, sources, costs, settings.
10. **Conversation details**: a persistent metrics rail sits beside the independently scrolling messages (above them on narrow windows). It shows the model, context tier, capacity and occupancy when reported, cumulative input/output tokens, cache usage and AI credits consumed, including subagents. Weighted premium requests and USD costs, when reported, remain separate from AI credits. Consumption is not the current context size. A missing metric says *Not reported*, never an estimate. Step metrics are kept in the local journal; free conversation metrics stay in memory for this window.
11. **Conversation attachments**: choose files, drop them on the message box, or paste an image into it. Image thumbnails and document chips appear above the text. Up to 10 files of 25 MB, copied next to the scenario or under `<root>/attachments/` and sent to the harness, including attachment-only messages. Drafts survive view changes during this application session. Pasted staging files are removed when the application closes normally; project copies stay.
12. **Journey and approvals**: dated register entries show produced files and explicit status badges. The highlighted row follows the latest launch, with the same scenario and the kit's review correction loop; its action prepares the next step or opens the active conversation. Scenario selectors include the first heading of a declared unit deliverable when available. A step is approved when every file in its `approves` list has a current approval. Its launch button is then disabled, including at the core API. *Reopen step* asks for confirmation and appends revocations to the shared approval file; documents and prior approvals stay. A shared document can also invalidate another step. Update older kits with APM to obtain the `reopen` function of their approval script.
13. **Reading**: Conversation and previews use the available content width. *Open file* opens the displayed document in the default desktop application. Client Sources separately offer *Read* and *Open file* for the conversion and *Open original* for the client document, when present. Executable formats and paths outside the project are refused. Informational notices disappear after five seconds; errors remain visible.
14. **Live Journey state**: the strip links to the session, pending AI questions and permissions, guards, and costs. The cost report loads on project opening and automatically refreshes on session usage and completion, even outside Costs. Bursts are grouped with at least five seconds between automatic reads; active work also checks for flushed logs every ten seconds. Snapshot refreshes do not independently poll costs, and idle projects do not poll. A pending change during a read schedules a subsequent read. Conversation credits are never added again to the report: it remains the authoritative measurement, provisional while sessions run. Costs can still refresh explicitly. Unrecognised consumption says *Not measured*, never zero. Kits without cost tracking say so. The heading and strip stay visible while the register scrolls. Thin scrollbars appear only during scrolling and disappear after 700 ms of inactivity without moving the content. Wide tables and diffs scroll only inside their own container.
15. **Taskbar activity (Windows)**: the application icon shows Windows' native indeterminate loading while an operation, AI step or free conversation works, even with the window minimized. It uses no estimated percentage. Short actions and background snapshot/log reads do not flash the indicator; human questions and paused steps do not count as ongoing AI work. Starting/stopping project services counts, but an already-ready service does not keep the loader active.
16. **Pause and resume**: Conversation offers Pause for an active step. It interrupts the current AI turn, cancels unanswered prompts without approving them, and retains the same session, context, files, draft and metrics. Resume becomes available only after the harness acknowledges the stop, then asks the AI to continue from the current files without repeating completed actions or bypassing guards. Actions already performed are not undone; independently running project services are not paused. A missing acknowledgement after 30 seconds is an explicit error, not a successful pause: retry Pause or stop the step. Same-session resume is available while Vibe Studio remains open; after an application restart the session is marked interrupted, never silently restarted.
17. **Build completion**: when the kit's build step declares no human approval checkpoint, a final produced report with evidence, completed tasks and passing end checks validates it automatically when the AI becomes idle. It shows *Automatically completed* and a link to its conversation, not Prepare or an unavailable manual approval. Interrupted, failed or incomplete builds are not validated. Later feedback edits do not erase a completed round; the review/feedback phase keeps its own human decisions and may request a new correction round.
18. **Previous conversations**: the latest session stays outside the labelled Previous conversations section. Collapse or expand that section to hide or show older sessions; the choice is saved in the local desktop preferences, including after restart. Selecting an older session does not lose access to the latest one, and its name remains visible when history is collapsed.
19. **Original notification themes**: Arcade 8-bit, Orbital station, Telegraph and Analog noir each provide a question/permission, success and error trio, individually approved before inclusion. Free-conversation replies reuse the approved success motif. Existing themes and the current selection remain unchanged. Preview each sound in Settings › Alerts; no commercial game recordings or recognisable game melodies are bundled. English is the canonical source language; translated theme names and interface copy belong to i18n.
20. **Recorded instruments**: Recorded acoustic piano and Recorded acoustic guitar use real recorded notes assembled into original notification motifs, not synthesized instrument approximations. Both trios were approved separately. Their six short stereo WAV clips are bundled for offline playback, loaded only when needed and cached locally in memory. Replies reuse the approved success clip; the current theme is not changed automatically. The source recordings are supplied by tonejs-instruments under CC BY 3.0; attribution and transformations are listed in `THIRD-PARTY-NOTICES.txt`, with the full licence and exact source/output hashes under `app/renderer/sounds/`. A missing recorded clip produces an explicit error and never silently falls back to a synthetic instrument.

21. **Manual corrections**: each R task offers Edit, Validate manually and Delete as a fallback when the AI cannot handle the correction. User feedback keeps editable text, screen and priority; review findings expose their full task text, including file references. Validation only marks the task done; it never approves a deliverable or substitutes for the review. Deletion reserves the identifier in a Markdown comment in `tasks.md` so it is not reused. Actions are blocked while a step on the unit or a free AI turn is active. A changed task list must be refreshed before editing.
22. **Readable selection and metrics**: scenario names include their number wherever they appear, including history. Costs separates the readable step title from the scenario title. Project language is a French/English selection. Conversation and Journey credit counters round to whole numbers; detailed Costs keeps decimals and the underlying measurements are unchanged.

Before a step, choose one of the kit's declared models, a context window and, when supported, a reasoning effort. New conversations offer the same controls. Effort choices come from Copilot, Claude or Codex capabilities, never from a guessed model table; Gemini does not expose this control. The default leaves the provider setting in effect unless the catalog reports a default. Unsupported explicit effort values fail before creating a session. Conversation metrics show selected context input budget and effort, and mark effort as unverified when the harness cannot report its effective value.

Context choices use the connected harness's catalog, not a hard-coded model table. When tier pricing provides a prompt budget, the picker labels it explicitly as maximum **input tokens**, rather than confusing it with the model's largest total window. Unknown limits remain *Not reported*. Refresh the model catalog to check recently changed availability.

For Copilot steps in a kit with cost tracking, Vibe Studio records the exact step, unit, session ID and run ID before sending the first AI prompt. If the kit cannot create that marker, launch fails explicitly and no prompt is sent. A successful marker is traced in the local run journal. Existing unmarked sessions must be reconciled from verified journal metadata, not inferred from prompts or assigned to whichever session ran most recently; unrelated free conversations remain unattributed.

A newly created Copilot SDK session may have only `workspace.yaml` before its first prompt, with no `events.jsonl` yet. The kit's cost marker must support that pre-prompt state by validating the exact workspace identity and project ownership; merely retrying an events-only marker or forcing an SDK save does not initialize the event log. Update an older cost-tracking kit when its marker rejects this state. Vibe Studio keeps the attribution guard enabled and shows the script's exit code and final diagnostic line on failure; it never sends a billable prompt just to create a log.
Free conversations offer the full known engine catalog. Copilot retains its last successful account-specific
catalog locally if discovery fails; the dialog identifies cached information and provides a retry action. On first
use without a cache, only kit-declared models are offered as unverified. This does not bypass authentication,
subscriptions or a real model/session failure, and does not enable arbitrary model identifiers.

Kits can supply a read-only scenario catalog so all declared scenarios appear before their folders are created.
Select a business title directly: there is no requirement to plan preceding numerical scenarios. Each scenario
retains its own inputs, approvals and genuine business dependencies. Kits without this optional provider keep
folder-based discovery; kit sources are updated in their own repository, never by migrating client files.

Data: preferences, recent projects and step journals use `%APPDATA%\Vibe Studio`. Existing data at this location stays intact. Vibe Studio does not inspect or import another application's profile or journal. An explicit `--user-data-dir` uses only the selected directory. Back up profiles before upgrading. For an isolated profile, use `npm start -- --user-data-dir="C:\Temp\vibe-studio-profile"` or pass the same switch to the portable executable.

### Application updates

About and Projects offer **Check for updates**. Packaged copies also check at startup and at most once per day; failed automatic checks remain visible there without interrupting work. `package.json` declares the public GitHub repository under `vibeStudio.updates.repository` (currently `shoyencode/vibe-studio`); remove `vibeStudio.updates` to disable checks. The repository and release assets must be anonymously readable. Private repositories, missing releases, network failures and GitHub API rate limits produce explicit errors; no token is requested or reused.

Installed Windows x64 copies offer **Download verified installer**, then **Close and install** with a native confirmation. Stable versions are compared numerically; drafts, prereleases and older versions are not proposed. Upload a release asset named `Vibe-Studio-Setup-X.Y.Z-x64.exe`; its size and `sha256:` digest must be available from GitHub's release-asset API. A missing digest blocks installation rather than bypassing verification. Downloads are bounded and restricted to HTTPS on GitHub and its release-assets CDN, including redirects, then checked again before execution. Vibe Studio refuses installation while a step, AI turn or project service is active. Save unsent drafts first; the installer targets the existing application folder and preserves the user profile. Portable/development copies link to the release instead of installing over an arbitrary folder.

The checksum protects against a corrupted download, not against a compromised publishing account or server. Publishing releases and changing the project visibility remain explicit maintainer operations; update detection never publishes anything.

## Harnesses

Vibe Studio drives one harness at a time, chosen in Settings › Harness (no step or conversation may be running). Each one needs the kit deployed for it by APM and a sign-in on the computer.

On Windows, each supported harness has a **Sign in…** button that opens its official sign-in command in a visible PowerShell terminal using Vibe Studio's tool paths. Complete authentication there, then choose **Check connection** to restart the idle adapter and refresh its account. Credentials never pass through the interface. Missing tools are reported instead of claiming a connection. On other platforms, run the displayed command in a terminal. Signing in to another desktop application or using a terminal-only token does not guarantee that Vibe Studio has persistent GitHub credentials.

| Harness | Adapter | Kit | Sign-in | What changes |
| --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `core/adapters/copilot.mjs`, Copilot SDK, runtime built into Vibe Studio | `apm install` (target `copilot`) | Sign in button: `gh auth login --hostname github.com --web`; existing persistent CLI credentials may also be used | reference: every function of Vibe Studio |
| Claude Code | `core/adapters/claude.mjs`, Claude Agent SDK, Claude Code installed on the computer (`claude` on the PATH) | `apm install --target claude` (`.claude/skills`, `.claude/agents`) | `claude auth login` or `ANTHROPIC_API_KEY` | agents run as the main thread; questions through `AskUserQuestion`; reads inside the project are approved by Claude Code itself |
| OpenAI Codex CLI | `core/adapters/codex.mjs`, `codex app-server` protocol (approval policy `untrusted`) | `apm install --target codex` (`.agents/skills`, `.codex/agents`) | `codex login` | no named agent: its prompt becomes developer instructions; read-only commands run without asking |
| Gemini CLI | `core/adapters/gemini.mjs`, ACP (`gemini --acp`), the official integration interface of Gemini CLI | `apm install --target copilot,gemini` (skills in `.agents/skills`; agents read from `.github/agents`) | run `gemini`, then `/auth`, or `GEMINI_API_KEY` | no agent selection: its prompt opens the first message; file writes go through Vibe Studio; the project is trusted (`--skip-trust`) |

For every harness: the guards are checked before each write, command and skill the harness asks to run; `vibe_studio_report` and, when the harness has none, `ask_user` are offered as Vibe Studio tools; the models of the kit are replaced by the closest model of the harness, which the launch dialog shows. Limits: actions a harness runs without asking escape the guards (mostly reads), the long context window is a Copilot option, and the Costs space measures Copilot sessions only.

Licences: the Copilot SDK and the Agent Client Protocol SDK are MIT or Apache-2.0; Codex CLI and Gemini CLI are Apache-2.0. Additional GitHub SDK/runtime and CLI notices are included in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), alongside the dependencies' own licence files. The Claude Agent SDK is covered by Anthropic's commercial terms: check that they allow its use in Vibe Studio before distributing it. Neither distribution includes the Claude Code program; the installer downloads it only when explicitly selected, under Anthropic's terms.

## Build the Windows installer

Build requirements: Windows x64, Node.js 22.12+, a Python installation with pip, and Internet access to prepare the distribution.

```powershell
npm ci
npm run installer:tools
npm run package:installer
npm run test:installer
```

`installer:tools` downloads and verifies Inno Setup 6.7.3 in portable mode under `dist\installer-cache`; it does not need a system-wide compiler. Alternatively, set `VIBE_STUDIO_ISCC` to a compatible `ISCC.exe`. `VIBE_STUDIO_BUILD_PYTHON` optionally selects the build-time Python executable. The compiler is used under the [Inno Setup licence](https://jrsoftware.org/files/is/license.txt).

The build produces `dist\Vibe Studio-Setup-<version>-x64.exe` and the existing portable ZIP. `scripts\installer\prepare-assets.ps1` reproducibly derives wizard artwork and a multi-size icon from the existing application logo using Windows' System.Drawing; generated resources stay in `dist\installer-assets`. No theme plugin or downloaded font is required. The installer includes a pinned Python 3.13 runtime and hash-locked Windows wheels, so pip is not run on the target computer. Optional archives have pinned versions and checksums in `scripts\installer\components.json`; Gemini's dependency graph is locked separately. Keep these versions, checksums, compatibility checks and licence notices together when updating them.

The default location is `%LOCALAPPDATA%\Programs\Vibe Studio`. Close Vibe Studio before upgrading. Uninstall through Windows Settings; the installer removes its own files and shortcuts, not reused external tools, projects, credentials or `%APPDATA%\Vibe Studio`. Project-specific dependencies (MCP servers, Docker, compilers and generated applications) remain outside the installer. No signing certificate is configured: Windows may display SmartScreen warnings.

The installer smoke uses a unique test installation identity, no Start menu/Desktop shortcuts, a temporary profile and a child PATH without system Python/Node/Git. It checks the real installed executable, Python imports, a fixture kit, reinstall, uninstall and persisted PATH preservation. `VIBE_STUDIO_KEEP_INSTALLER_SMOKE=1` retains its temporary diagnostics. It does not replace validation on a clean, non-administrator Windows machine.

`npm run test:installer:ui` is an opt-in check for an interactive Windows desktop. It walks the real French/English offline wizard, installs and uninstalls under unique test identities, and captures only its own window in `dist\installer-ui`; it never launches Vibe Studio or changes your Windows appearance. The default test follows your current theme and DPI. To check a light/dark variant without changing Windows settings, compile the same script into a separate test output with Inno's `/DWizardAppearance="modern light"` or `"modern dark"`, then pass `-Installer <test-exe> -Artifacts <output-folder>` to `scripts\smoke-installer-ui.ps1`. High-contrast and other DPI settings still require an appropriate Windows test environment.

The installer helper emits bounded `VIBE|component|phase|percent` records for the native progress page; tool output is prefixed separately. Its ASCII `.ini` report records successfully verified tool outcomes and is installed as `setup\installation-result.ini` alongside the human-readable report. A retry clears the previous success report before preparing tools.

`npm run test:installer:tools` is an **opt-in online check**: it downloads all optional tools, including Claude Code under Anthropic's terms, into a temporary private installation. It checks native resolution, Git Bash, the Codex app-server handshake and reuse without personal sign-in or AI prompts. It is not part of default CI. `VIBE_STUDIO_SMOKE_TOOLS` may point to an existing disposable test root containing a `tools` directory; never use an actual installation.

## Build the portable version

```
npm ci
python -m pip install -r requirements.txt
npm run package
```

On Windows x64, it writes `dist/Vibe Studio-win32-x64/Vibe Studio.exe` and `dist/Vibe Studio-win32-x64.zip` (Electron and the Copilot SDK runtime are included; Python and the other CLIs are not). Unzip it anywhere in the user space. Close all processes using the old portable before replacing its folder; packaging refuses to overwrite a running executable in `dist`. This is a portable distribution, not an installer; it needs no administrator rights.

The application runs independently from this repository root and never reads a sibling checkout, developer profile or developer-specific path. Open a project with an installed kit instead. Vibe Studio owns its protocol-2 contract schema in `core/schema/vibe-studio.schema.json`; kits implement that public contract independently.

## Run the tests

```
npm ci
python -m pip install -r requirements.txt
npm test
npm run test:bridge
npm run test:smoke
npm run package
npm run test:portable
```

`VIBE_STUDIO_PYTHON` sets the Python executable used by the bridge (default `python`). A migration adapter still accepts a previous installation's override. The setting is an executable path, not a shell command. `npm run test:bridge` uses `python` directly.

All four harness adapters are covered with fake clients/protocols: these checks and the desktop smoke make no AI requests. Smoke tests use temporary profiles, never the real user profile or Start menu. `VIBE_STUDIO_SMOKE_ARTIFACTS` optionally selects a screenshot directory. After packaging, set `VIBE_STUDIO_SMOKE_APP` to the absolute `dist\Vibe Studio-win32-x64\resources\app` path and rerun `npm run test:smoke` to exercise the packaged modules with the same fake harness.

Bridge checks use only the bundled reference fixtures: they validate protocol-2 contracts, approval scripts and project snapshots without reading another repository. Unsupported protocol versions and missing current contracts are refused without rewriting project files. Fixtures are pinned and updated deliberately, not automatically.

CI: [GitHub Actions](https://github.com/shoyencode/vibe-studio/actions) runs `.github/workflows/ci.yml` on pull requests, pushes to `main`/`master`, version tags and manual dispatch. Node/Python regressions run on hosted Ubuntu and Windows runners. Once both pass, a hosted Windows runner checks the desktop, builds the installer and portable, and checks the bundled application, real portable executable and install/reinstall/uninstall preservation. Each command has its own step so an early failure cannot be hidden by a later successful command. Package/lockfile versions must agree, and a version tag must match them.

The `vibe-studio-windows` workflow artifact contains `Vibe-Studio-Setup-X.Y.Z-x64.exe` and `Vibe-Studio-X.Y.Z-win32-x64.zip`, named for GitHub release upload and application update detection. Pushing a matching `vX.Y.Z` tag automatically creates a GitHub release with generated release notes and attaches the verified EXE and ZIP after all checks pass. Only the tag-triggered publication job has repository write permission; pull requests, branch pushes and manual runs retain artifacts without publishing. CI never creates tags or replaces an existing release; publication fails explicitly if the release already exists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and commit, changelog and release conventions. Coding agents follow the same rules through [.github/instructions/changelog-and-commits.instructions.md](.github/instructions/changelog-and-commits.instructions.md); keep the two documents in sync.

## Compatibility

Vibe Studio is an independent application with its own releases and contract schema. The current application version is **3.0.0**, with manual correction management, model reasoning controls and verified Windows updates. Current protocol-2 kits with T/R task identifiers are required; see [the migration instructions](CHANGELOG.md#migration-from-21). The original MIT copyright is preserved in [LICENSE](LICENSE).

The supported public contract is `vibe-studio.json`, protocol 2. Kits use `vibe_studio_report`, the `vibe_studio` MCP namespace and `vibe_studio.*` events. Desktop communications use `vibe-studio:*`, `window.vibeStudio` and `vibe-studio://`. Other contract filenames, protocol versions and renamed runtime identifiers are not adapted. Update kits with APM before opening them. Client files and user message text are never renamed or rewritten automatically. See [docs/vibe-studio-contract.md](docs/vibe-studio-contract.md) and [test/fixtures/README.md](test/fixtures/README.md).
