# Changelog

Versions follow Semantic Versioning. Application versions are independent of kit release numbers.

## 3.0.0

### Added

1. `app`: correction tasks (R) can be edited, manually marked done or deleted as a fallback without running the AI. Confirmations, active-session protection and stale-file checks preserve task history and prevent accidental overwrites.
2. `app`: step launches and new discussions offer the reasoning efforts reported by their model and harness. Conversation metrics distinguish the selected effort and context budget from verified runtime settings.
3. `app`: installed Windows copies check public GitHub releases at startup and at most once a day. Updates download only on request, are SHA-256 verified before launch and require confirmation before closing the application; portable copies link to the release page.

### Changed

1. `app`: Vibe Studio 3.0.0 adds manual correction management, model reasoning controls and verified Windows updates, and requires current protocol-2 kits with T/R task identifiers.
2. `app`: scenario titles include their number throughout navigation, the journey and history. Costs show readable step and scenario titles in separate columns.
3. `app`: project language is selected from French and English rather than entered as a code. Conversation and journey credit counters display rounded integers while detailed cost reports retain decimals.
4. `app`: a separator distinguishes the Conversation page heading from its controls and messages in both themes.
5. `ci`: GitHub Actions is the sole repository CI, with Linux/Windows regressions, individually checked Windows packaging steps and versioned installer/portable artifacts ready for release upload. Version tags must match the package and lockfile.
6. `contributing`: interrupted test workspaces, temporary profiles and npm debug logs stay untracked; Windows packaging also excludes leftover test profiles. Test sources and fictional fixtures remain versioned, and retained diagnostics belong under the ignored distribution folder.

### Changed (breaking)

1. `core`: kits must provide `vibe-studio.json` with protocol 2 and the current tool/event namespaces. Contract conversion, renamed-identifier translation, imports from other application journals and automatic imports from other profiles are removed.
2. `core`: task identifiers use T for build tasks and R for corrections; U task identifiers are no longer recognised.

### Migration from 2.1

1. `kits`: update installed kits with APM before opening them. Use `vibe_studio_report`, MCP `vibe_studio` and `vibe_studio.*` events. Convert any U correction identifiers to unique R identifiers in the kit's own migration process; Vibe Studio does not rewrite project files.
2. `profile`: existing `%APPDATA%\Vibe Studio` data is still used without modification. Back up any data held by a different application and recover it explicitly if needed; those profiles and journals are no longer inspected or imported. An explicit `--user-data-dir` uses only the selected directory.

## 2.1.1

### Changed

1. `app`: Vibe Studio 2.1.1 improves cost-attribution failure diagnostics while preserving existing profiles and kit contracts.

### Fixed

1. `core`: cost-script failures include their exit code and a bounded diagnostic instead of hiding the reason a tracked step cannot start.

## 2.1.0

### Added

1. `app`: each supported harness offers a Windows sign-in button that opens its provider command in a terminal, followed by an explicit connection check without handling credentials in the interface.
2. `app`: conversation metrics stay visible beside independently scrolling messages, or above them in narrow windows, and include reported AI credits separately from premium requests and dollar costs.
3. `app`: the Windows taskbar icon shows native indeterminate loading during long operations and AI activity, including while minimized; it clears when work ends or waits for human input.
4. `app`: running steps can be paused and resumed from Conversation without losing their session, context, files or metrics. Resume stays unavailable until the harness confirms interruption.
5. `app`: previous conversations are labelled and collapsible; their visibility is saved across navigation and application restarts, while the latest conversation remains accessible.
6. `app`: the individually approved Arcade 8-bit, Orbital station, Telegraph and Analog noir themes add original question, success and error notifications, without changing the selected theme or reusing commercial game recordings.
7. `app`: individually approved recorded acoustic piano and guitar trios use bundled real-instrument recordings rather than synthesis. They work offline and include CC BY 3.0 attribution, licence text and source/output provenance.

### Changed

1. `app`: Vibe Studio 2.1.0 adds session pause/resume, Windows sign-in shortcuts, persistent conversation history controls and new notification sounds while preserving existing profiles and kit contracts.
2. `app`: thin scrollbars appear only while scrolling and disappear after inactivity without shifting the content. Navigation indicators, tool icons and Markdown task markers keep clear spacing from their labels.

### Fixed

1. `app`: cost reports load once when opening a project with cost tracking, without repeated background polling or carrying a report into another project.
2. `core`: context choices use the harness's actual per-tier input budgets instead of presenting the model's largest window as its standard context; older model caches are refreshed.
3. `app`: Costs and Journey refresh automatically as session usage arrives and after completion, with grouped reads and no duplicate addition of conversation credits.
4. `copilot`: a tracked step starts only after its exact session/run cost marker is recorded; attribution errors are shown instead of silently sending billable work to the unattributed bucket.
5. `app`: completed build steps without a human approval checkpoint are automatically validated after their final report, completed tasks and successful end checks. Later feedback does not invalidate their completed round; review approvals and correction cycles remain separate.
6. `docs`: product references, canonical interface labels and design-preview copy use English; contributor guidance keeps localized messages, locale tests and compatibility fixtures separate.

## 2.0.0

### Added

1. `core`: kits can declare per-step and per-agent model choices and a read-only scenario catalog provider. Conversations offer the full known model catalog; both launch dialogs expose supported context windows.
2. `copilot`: the last successful account-specific model catalog is retained locally when discovery fails. Without a previous catalog, only models declared by the opened kit are offered, explicitly marked unverified.
3. `app`: the Mission Logbook journey shows dated entries, named deliverables and explicit status badges under a live strip linking to sessions, pending AI requests, guards and consumption. Costs are read only on request; unmeasured consumption is never shown as zero.
4. `docs`: product and design references document the confirmed audience, neutral French register, Mission Logbook direction and light/dark accessibility requirements.

### Changed

1. `app`: Vibe Studio 2.0.0 introduces the Mission Logbook interface and standardises public desktop and kit identifiers, with compatibility adapters and recoverable profile migration.
2. `app`: document actions stay compact and inline. Client sources distinguish the original from the converted file; deliverables and the reader use Open file.
3. `app`: scenario selectors show business titles and allow any catalogued scenario to be selected before its folder exists, while retaining its own prerequisites and approvals.
4. `packaging`: the application executable and its shortcuts use Vibe Studio's multi-size icon; permission switches have symmetric thumb alignment.
5. `app`: the current journey row replaces the next-step banner. The heading and live strip stay visible while the register scrolls; compact layouts stack dates and actions without horizontal page overflow.
6. `app`: French interface copy uses a neutral register. Thin scrollbars, visible keyboard focus, stronger dark-theme contrast and integrated confirmation dialogs improve accessibility; Markdown rendering reuses parsed content.

### Changed (breaking)

1. `app`: all public desktop and kit identifiers use Vibe Studio: `vibe-studio.json`, `vibe_studio_report`, MCP `vibe_studio`, events `vibe_studio.*`, IPC `vibe-studio:*`, `window.vibeStudio` and the `vibe-studio://` scheme.
2. `profile`: the active default profile is `%APPDATA%\Vibe Studio`. Previous data is recovered without retaining a profile folder under the former product name; collisions remain recoverable in a Vibe Studio migration backup.

### Migration from 1.0

1. `profile`: close running copies before the first updated launch. The default profile is migrated automatically; existing active values win when both profiles exist. An explicit `--user-data-dir` is isolated and does not migrate the default profile. Startup stops explicitly on migration failure.
2. `kits`: update Vibe Studio before installing renamed kit assets. Compatibility adapters read previous contract filenames, tool declarations and events without rewriting client files or user messages. New kits and desktop integrations must use the new public identifiers.

## 1.0.0

### Added

1. An *Approve All* switch authorises tools without answering questions when Autopilot is off. Guard refusals and mandatory confirmations remain enforced. The choice is a local user preference.
2. Conversations show the model, context capacity and occupancy when reported, and cumulative input, output and cache tokens, including subagents. Missing metrics are labelled as not reported.
3. Conversation attachments support file selection, image paste and drag-and-drop, with image thumbnails and document chips above the message. Files are copied into the project and sent to the harness.
4. Approved journey steps are disabled and can be reopened after explicit confirmation. Revocations are appended to the shared approval history without changing the documents. Older kits must update their approval script with APM.
5. Original deliverables open in the default application of the computer. Personal settings include a light, dark or system theme.
6. Standalone application repository, bundled MIT-licensed test fixtures, bridge regression tests and local CI/Windows portable checks without a sibling kit checkout or AI requests.
7. `contributing`: contributors and coding agents share documented commit, changelog and release conventions adapted to Vibe Studio.
8. `packaging`: a per-user Windows x64 installer includes private Python and a GitHub sign-in helper for an offline base installation, offers Git/APM by default and Claude/Codex/Gemini as optional verified downloads, and preserves existing tools and user data. A tools terminal exposes private commands without changing Windows PATH; CI retains both installer and portable artifacts with additional third-party licence notices.

### Changed

1. `app`: Vibe Studio 1.0.0 is the first standalone stable release, named **Vibe Studio** throughout the desktop interface, window, package, Windows notifications/shortcut, executable and distribution. Existing profiles stay in `%APPDATA%\Vibe Studio`; deployed `vibe-studio.json` contracts and reporting tools remain compatible.
2. Conversation and document previews use the available width. The redundant logo and name above navigation are removed.
3. Settings separates local personal preferences from project and kit configuration. Informational notices disappear after five seconds; errors remain visible.
4. `packaging`: the Windows installer adopts Vibe Studio's logo and a system-aware light/dark appearance, explains components in French and English, reports real download/preparation progress and shows verified installation results inside the wizard.
5. `core`: Vibe Studio owns its contract schema and neutral reference fixtures independently of external kits. Documentation, messages and executable metadata use application-specific branding; legacy kit identities come from APM metadata, with protocol and profile compatibility preserved.

### Fixed

1. The next-step banner follows the latest launched step and its scenario, retaining the review correction loop rather than returning to the first incomplete step. Scenario titles are read from their deliverables and displayed in the journey.

## 0.3.0

Earlier embedded release: step and feedback attachments, alerts, free conversations, Autopilot, personal sound/harness preferences, application/kit versions, and Copilot, Claude Code, Codex and Gemini harness adapters.
