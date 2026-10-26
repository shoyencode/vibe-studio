# Product

<!-- impeccable:product-schema 1 -->

> Written by `/impeccable init` from the repository, then confirmed with the user on 2026-10-23.
> Anything marked **[inferred]** is a hypothesis the user has not confirmed yet.

## Platform

web

Electron 41 desktop application for Windows 10 22H2 / 11 x64. The interface is HTML/CSS rendered by Chromium, so it follows web design language, not native Windows (WinUI) controls.

## Users

- **Kit users (primary):** anyone running a structured mission (pre-sales POC, audit, migration…) with an AI kit, developers and non-developers alike. Every screen must therefore work without technical knowledge (no terminal, no CLI vocabulary required) without slowing down a developer. They spend long periods in the app, working alongside the AI step by step: they launch steps, answer the AI's questions and permission requests, read deliverables and approve them.
- **Kit authors:** developers who package skills, agents and rules with APM and write the `vibe-studio.json` contract (`docs/creating-a-kit.md`). They build the kits; they are not the main audience of the interface.

## Product Purpose

Vibe Studio drives AI kits on top of an agent harness (GitHub Copilot CLI by default; Claude Code, Codex CLI or Gemini CLI as options). The kit declares its journey in a contract. Vibe Studio reads it, opens one harness session per step, follows tasks, shows deliverables, approvals, costs and the application built, and enforces the kit's guards.

Success means the user completes the kit's journey with every deliverable approved, stays in control of what the AI does, and never has to use a terminal.

## Positioning

Vibe Studio is a contract-driven cockpit, not a chat client. The kit's `vibe-studio.json` defines the journey, its units, deliverables, approvals and guards. Vibe Studio turns that into a step-by-step flow and enforces the guards before every write, command and skill, whichever of the four supported harnesses runs. The user approves deliverables through files kept in the project. An approval is a project fact, not just a chat message.

## Operating Context

- Windows workstation with a local project folder where APM installed a kit. The user signs in to the harness separately (`gh auth login`, `claude auth login`, `codex login`, `gemini`).
- Main areas: Projects, Journey, Conversation, Deliverables, Client Sources, Themes, Settings, About, plus spaces declared by the kit (units/scenarios, application, costs).
- Conversation sessions can run for a long time. The AI asks questions and permissions. Tones and Windows notifications bring the user back when the window is not in front.
- The user reads a lot: conversation replies and Markdown deliverables shown at full content width. Client documents are converted, and the original stays openable.
- Preferences live in `%APPDATA%\Vibe Studio`, never in the project. Data stays local.

## Capabilities and Constraints

- Four harness adapters (`core/adapters/`). Copilot is the reference and the only harness with full functionality, including the long context window and the Costs space.
- Guards checked before writes, commands and skills. Autopilot and Approve All modes never bypass guard refusals or required confirmations. The AI must never record an approval on behalf of the user.
- Attachments: up to 10 files of 25 MB, copied into the project.
- A metric the harness does not report is shown as *Not reported*, never estimated.
- Interface in French and English (`core/i18n.mjs`). Light, dark or system theme.
- Minimum window width 820 px (default 1280×860).
- Installer for the current user, no administrator rights; Windows PATH, tools and accounts are not modified.
- The former product name must not reappear (the smoke test checks for `.brand`).

## Brand Commitments

- Name: **Vibe Studio**. Asset: `app/renderer/logo.png`.
- Voice in the interface: direct and factual. **French copy uses a neutral register, without informal or formal second-person address**: infinitives, nouns and impersonal phrasing. Canonical labels, copy examples and design previews use English (for example "Drop files here", "Message to the AI"); localized interface messages belong in `core/i18n.mjs`.
- The installer's Windows assistant is branded, follows the system appearance, and keeps native keyboard navigation and high contrast.

## Evidence on Hand

- Reference kits under `test/fixtures` (including `demo`), MIT-licensed.
- Docs: `README.md`, `docs/vibe-studio-contract.md`, `docs/creating-a-kit.md`, `CHANGELOG.md`.
- There are no testimonials, customer names, adoption figures or benchmarks; future work must not invent any.

## Product Principles

1. **The user stays in charge.** The AI proposes and the user decides. Approvals, guard suspensions and permissions are explicit human acts.
2. **The contract is the source of truth.** The kit defines the journey. Vibe Studio does not invent steps, models or deliverables.
3. **Honest state.** Show what is known, and say "not reported" when it is not. Errors stay visible until the user handles them.
4. **No terminal required.** Everything a mission needs is reachable from the interface.
5. **Local and harmless.** Never modify the system, the project outside its declared paths, or personal accounts without the user's explicit action.

## Accessibility & Inclusion

- Required standard: **WCAG 2.2 AA in both light and dark themes**. This includes contrast, keyboard navigation, visible focus kept across refreshes, and a non-intrusive live region during streaming.
- Respect the system's high-contrast mode and keyboard navigation, as the installer already does.
- Respect reduced motion.
