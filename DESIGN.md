---
name: Vibe Studio
description: Contract-driven cockpit that steers AI kits step by step, on Windows.
colors:
  surface: "light-dark(#ffffff, #1f2328)"
  ink: "light-dark(#1f2328, #e6edf3)"
  muted: "light-dark(#59636e, #9198a1)"
  line: "light-dark(#d1d9e0, #3d444d)"
  control-border: "light-dark(#818b98, #7d8590)"
  accent: "light-dark(#0969da, #4493f8)"
  accent-fill: "light-dark(#0969da, #1f6feb)"
  on-accent: "#ffffff"
  warn: "light-dark(#bc4c00, #db6d28)"
  danger: "light-dark(#b42318, #f85149)"
  danger-fill: "light-dark(#cf222e, #da3633)"
  success: "light-dark(#1a7f37, #3fb950)"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
  mono:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "0.8125rem"
rounded:
  field: "5px"
  control: "6px"
  card: "8px"
  bubble: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.danger-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  button-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  nav-item-current:
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  focus-card:
    rounded: "{rounded.card}"
    padding: "14px 16px"
  user-bubble:
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
    padding: "8px 12px"
  status-badge:
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  indicator-strip:
    backgroundColor: "{colors.line}"
    rounded: "{rounded.card}"
  indicator-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "10px 14px"
  register-entry-current:
    rounded: "{rounded.control}"
    padding: "11px 10px"
---

# Design System: Vibe Studio

<!-- Tokens extracted from app/renderer/style.css and desktop.css (single token source in :root). Direction confirmed with the user on 2026-10-23 (mockup: blend of "Field Notebook" and "Control Room"). -->

## Overview

**Creative North Star: "The Mission Logbook"**

Vibe Studio is a mission's logbook, kept under supervision. Two readings coexist on every screen:

- **The register (Field Notebook):** what has been done stays traceable. Every entry is dated, every file produced is named, and every approval shows its date. Files and timestamps are set in Cascadia Mono.
- **The live state (Control Room):** what is happening now is readable at a glance. A strip of live indicators (session, AI questions, guards, consumption) sits above the register, and a status badge sits on each entry. A state that calls for the user switches to Guard Orange.

The rest steps back: a white or graphite surface, Windows system typography, hairline borders, and a single blue that marks *the* row to handle now. The kinship with the GitHub world (Primer palette, Segoe/Cascadia) is deliberate: it reassures a user who knows Copilot, without becoming a copy of it. Developers and non-developers use the same screens, so every state is spelled out in words, never by color alone.

The density is that of a productivity tool: 14px text, 36px controls, generous reading width for the AI's responses. Light and dark have equal standing: every color is a `light-dark()` pair, and the system theme is the default.

**Key Characteristics:**
- Register first: dated entries, named files in mono, dated approvals.
- Live state on top: an indicator strip, plus a status badge (dot + word) per entry.
- Flat, with no shadows; hierarchy comes from tonal tinting and hairline borders.
- A single accent (blue) for the row to handle now and its button; orange, red and green only for states.
- Discreet scrolling: never horizontal, thin bar visible only while scrolling, always separated from the content.
- Native Windows typography (Segoe UI Variable, Cascadia Mono); WCAG 2.2 AA in both themes.

## Colors

A neutral GitHub-style palette, one active blue and three state colors; everything is defined as a `light-dark()` pair in `:root`.

### Primary
- **Signal Blue** (`#0969da` / `#4493f8`): links, current navigation item, accent text, focus ring.
- **Action Blue** (`#0969da` / `#1f6feb`): fill of the primary button. In dark mode it is darker than Signal Blue so white text stays at ≥ 4.5:1.

### Semantic
- **Guard Orange** (`#bc4c00` / `#db6d28`): autopilot on, pending AI question, guard warning. Soft background `--warn-soft` (8% over the surface).
- **Refusal Red** (`#b42318` / `#f85149`): error text, invalid field. Fill **Destructive Red** (`#cf222e` / `#da3633`) for confirmation buttons in destructive dialogs.
- **Approval Green** (`#1a7f37` / `#3fb950`): approved step or deliverable.

### Neutral
- **Paper / Graphite** (`#ffffff` / `#1f2328`): the single surface; there is no separate "page background".
- **Ink** (`#1f2328` / `#e6edf3`): text.
- **Muted Slate** (`#59636e` / `#9198a1`): secondary text, metadata, hints.
- **Hairline** (`#d1d9e0` / `#3d444d`): dividers and decorative borders (no contrast requirement).
- **Control Edge** (`#818b98` / `#7d8590`): borders of interactive fields and the switch track (≥ 3:1).

### Named Rules
**The One Signal Rule.** On a given screen, the accent tint marks a single thing: the row or card to handle now and its `.primary` button (plus the current location in the navigation). Secondary cards stay neutral.

**The Spelled-Out State Rule.** A state color always comes with a word ("Approved on 22/10", "Awaiting a response", "Upcoming"). Color confirms; text informs.

**The Pair Rule.** No color is added without its `light-dark()` pair, and new colors are added as tokens in `:root`, never as hex values in a component.

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui)
**Mono Font:** Cascadia Mono (with Consolas)

**Character:** The system font of Windows 11, legible at small sizes and familiar; Cascadia is used for code, paths and diffs.

### Hierarchy
- **Headline** (600, 1.5rem, 1.25): view title (`h1`), one per view, `text-wrap: balance`.
- **Title** (600, 1.25rem, 1.3): sections (`h2`).
- **Subtitle** (600, 1rem): sub-sections, the title of the focus card.
- **Body** (400, 0.875rem, 1.55): running text; paragraphs capped at 72ch, Markdown at 960px.
- **Label** (400, 0.8125rem): small controls, metadata.
- **Caption** (400, 0.75rem): file chips, toolbar actions, counters.

### Named Rules
**The Six Steps Rule.** Sizes come only from `--text-xs` … `--text-2xl`. No literal `px` in `font-size`.

## Layout

A two-column desktop shell: a 188px nav sidebar (separated by a hairline border) + content `minmax(0, 1fr)` scrolling independently, with 24px padding. Window 1280×860 by default, 820px minimum. Below 620px, forms and model selection switch to a single column. The spacing rhythm follows 4 / 8 / 12 / 16 / 24 px. Conversation reserves a 216px metrics rail beside the flexible message column, separated by 24px. Below 760px of content width the rail becomes a compact three-column band above messages. Messages scroll independently; metrics and the composer stay visible. The user's bubbles are capped at 75% and right-aligned.

The Journey stacks three bands: a heading with a one-line summary of the displayed steps, the live indicator strip, then the register and launch history, which scroll together. The heading and indicators stay visible. Unit and task views keep their existing layout. Below 560px of content width (container query), each register entry stacks its date, content and actions.

### Scrolling
- **Never horizontal for page layout.** Content wraps (`min-width: 0`, `overflow-wrap: anywhere`, `flex-wrap`); scrolling areas use `overflow-x: hidden` (or `clip`). Wide tables (`.table-wrap`) and conversation diffs (`.convo-request .diff pre`) may scroll horizontally within their own bounds; regular code blocks wrap.
- **Thin and quiet.** `scrollbar-width: thin`; transparent thumb and track at rest, including hover. A captured scroll event reveals only the scrolling element's thumb (40% ink); it disappears after 700 ms without scrolling. The stable gutter prevents layout shifts. In forced colors, the active thumb uses system colors.
- **Never against the content.** `scrollbar-gutter: stable` plus 12–14px of inner padding on the scrollbar side and at the bottom, so neither the bar nor the last row touch the content.

### Native activity and pause

- Windows taskbar feedback uses the native indeterminate progress animation, not a replacement app icon, custom rendering loop or invented percentage. A 200ms delay avoids flashes for short actions; completion clears it immediately. Background snapshot/log reads, ready services and a step waiting for a human or paused by the user do not animate. The operating system owns the motion and its system preferences, including when the window is minimized.
- Conversation keeps Pause/Resume next to Stop in a fixed session header, accessible while messages scroll. Pausing waits for the harness acknowledgement; only then does Resume appear. A paused step retains its dated register entry and receives a static pause marker in navigation plus the word "Paused", never an animated waiting dot. Drafts and metrics remain intact. A pause does not imply approval, completion or rollback of files.
- Older session selectors sit in a native details/summary labelled "Previous conversations". The latest session remains outside the fold; visibility is a persisted preference, not reset by a render. Selecting an older session keeps a visible consulted-session label even when the history is collapsed.
- A build without a declared human approval checkpoint shows "Automatically completed" after successful completion. The approved-color badge does not fabricate a person or validation-file entry, and its action opens the conversation rather than offering Prepare. Review/feedback approval remains human and correction rounds can still reopen construction.
- Optional sound themes preserve three clear meanings: a question cue, a resolved success cue and a distinct lower error cue. Arcade 8-bit, Orbital station, Telegraph and Analog noir are original, individually approved trios under one second; replies reuse success rather than introducing an unapproved fourth sound. Adding a theme never changes the user's current selection. Canonical labels in source and documentation are English; UI translations belong in i18n.
- Recorded acoustic piano and guitar are separately approved instrument trios, assembled from real recorded notes rather than oscillators. Their natural attack and gently faded tails last roughly 1.3–1.9 seconds. Clips are bundled for offline playback, with documented CC BY 3.0 provenance; a missing asset must not be replaced with a synthetic approximation without notice.

## Elevation & Depth

No shadows. Depth comes from a light tint over the surface (`color-mix` 3–10%) and from 1px borders. Dialogs use a dark translucent backdrop (`rgb(1 4 9 / 45%)`) rather than a shadow.

### Named Rules
**The Flat Rule.** No `box-shadow`. To bring an element forward, tint it or give it a border; to isolate it, use a native dialog.

## Shapes

Soft and modest corners: fields 5px, buttons 6px, cards and dialogs 8px, conversation bubbles 10px, pills and chips 999px. Borders are always 1px and complete; never a colored side stripe.

## Components

### Buttons
- **Shape:** gently rounded (6px), at least 36px high (32px for compact buttons and chips).
- **Default:** surface background, hairline border; hover: 7% ink tint.
- **Primary:** Action Blue + white text; hover darkened 15%.
- **Danger:** Destructive Red + white text; only for confirming an irreversible action in a dialog, where Cancel keeps the focus.
- **Pill:** refresh in the sidebar, file chips (999px).
- **Disabled:** opacity .6, `not-allowed` cursor.
- **Focus:** 2px Signal Blue outline, 3px offset.

### Inputs / Fields
- **Style:** 1px Control Edge border, 5px radius, surface background, padding 8×10.
- **Invalid:** Refusal Red border.
- **Switch:** 34×20 track in Control Edge, white thumb with 3px insets; on → Guard Orange (autopilot).

### Navigation
- Text buttons with no border, aligned left. Current item: Signal Blue, 600, 9% blue tint. A separate secondary group (About, Settings) under a hairline; at the bottom, the project card and the Refresh pill.

### Cards / Containers
- **Active session card:** retained in the unit view only (8px, padding 14×16). Its activity label follows the title, never precedes it. The Journey uses its current register row instead of a separate focus card.
- **Current task:** neutral (3% ink tint, hairline border), 6px.
- **AI request:** Guard Orange tint and border while it waits; neutral once answered.
- **Guard bar:** full 1px orange-tinted border, 6px.

### Live Indicator Strip (signature)
- A single 8px frame cut into four cells by 1px hairlines (`gap: 1px` on a `--line` background). Four columns above 680px of content width, two below, one below 340px; no empty tinted cell.
- Each cell: caption label (0.75rem, muted) over a value (1rem, 600, tabular figures).
- A cell that calls for the user (pending AI question) takes the Guard Orange tint (7%) and an orange value. No other cell is colored.
- Each cell is a keyboard-accessible button to Conversation, Settings › Guards or Costs. The questions cell includes pending permissions. The consumption cell displays the report loaded on project opening and refreshed on usage and completion (grouped, at most once per five seconds), with a ten-second log check only while work is active. Navigating Journey does not independently poll it. Conversation credits are not added on top of report totals. It says "Not measured" when no recognised session is measured. A kit without cost tracking shows a disabled, explicitly unavailable cell.

### Status Badge
- Pill (999px), 1px `currentColor` border, a 7px dot, 0.75rem semibold text. Long labels may wrap instead of clipping.
- Approval Green "Approved on <date>", Guard Orange "Awaiting a response", Signal Blue "In progress" (dot pulses only without `prefers-reduced-motion`), Muted "Upcoming".

### Register Entry (signature)
- Three-column row: date and time in mono (104px), title over the produced files in mono and muted, then badge and action on the right. Separated by hairlines.
- The entry to handle now gets the 6% blue tint, 6px corners and the `.primary` button; it is the only blue element in the register.
- Guard information sits under the title in Guard Orange, as text.
- Dates use the latest current approval, otherwise the last run timestamp or the latest produced file modification. Unknown dates show "—", never a fabricated date. Approval dates accept the kit's French and ISO formats.

### Dialogs
- Native `<dialog>`, 8px, padding 24, width min(560px, 100% − 24px), dark backdrop. Destructive confirmations: Cancel on the left with focus, Danger action on the right.

## Do's and Don'ts

### Do:
- **Do** define every new color as a `light-dark()` token in `:root` in `style.css`.
- **Do** keep the blue tint for one element per screen (The One Signal Rule).
- **Do** keep ≥ 4.5:1 for text and ≥ 3:1 for control borders, in both themes.
- **Do** use `--text-*` for every size and `--font-mono` for code and paths.
- **Do** guard every animation with `prefers-reduced-motion`.
- **Do** date every register entry and approval, and name the produced files in `--font-mono`.
- **Do** pair every state color with a word (The Spelled-Out State Rule).
- **Do** keep scrollbars thin (`scrollbar-width: thin`) with padding between the bar and the content.

### Don't:
- **Don't** use `box-shadow`, gradients or glassmorphism.
- **Don't** use a colored side border (`border-left` > 1px) as an accent.
- **Don't** use white text on Signal Blue `#4493f8` in dark mode: use `--accent-fill`.
- **Don't** put a small uppercase label above a heading.
- **Don't** call `confirm()` / `alert()` natively: use the integrated dialog.
- **Don't** let a page layout scroll horizontally; wrap content instead (bounded tables and diffs excepted).
- **Don't** add a second colored indicator cell or a second blue row on the same screen.
