---
name: Vibe Studio website
description: The live mission register — the application's dark palette set as a page the visitor supervises.
colors:
  surface: "#1f2328"
  deep: "#181b20"
  raise: "#262c33"
  ink: "#e6edf3"
  muted: "#9198a1"
  line: "#3d444d"
  accent: "#4493f8"
  accent-fill: "#1f6feb"
  warn: "#db6d28"
  danger: "#f85149"
  success: "#3fb950"
typography:
  display: "Hubot Sans (variable, width 125%, weights 300–820)"
  text: "Mona Sans (variable)"
  mono: "Monaspace Neon 400/600"
---

# Design: Vibe Studio website

This document covers the website in `site/` only. The desktop application keeps its own system in the root
`DESIGN.md`; the site deliberately reuses its dark palette and component language but has its own type scale.

## North star: the live mission register

The home page is a running mission register in which the visitor is the supervisor. It refuses the gradient
hero, centred screenshot and feature grid of AI tool sites. The AI works; you sign off.

- **First viewport:** a two-line expanded headline (muted light line, then heavy line) and a lead on the left;
  on the right, a register of dated steps ending with the AI's question, whose answer is the download.
- **Indicators:** GitHub figures are the application's live indicator strip — hairline cells, caption over a
  tabular mono value. Live values come from the GitHub API in the browser (cached one hour); build-time values
  fill the gaps and say so. A missing value shows "—", never an invented figure.
- **Story:** the page continues as numbered steps along a dashed rail. Each step pairs a claim with proof —
  a guard refusal, a real screenshot, the four harnesses, a workshop proposal. The last dot is blue: the step
  to handle now.

## Colors

The application's dark tokens, used as in the app:

- **Guard Orange** marks only what awaits the visitor: the AI question with the download, the guard line.
- **Signal Blue** marks the row to handle now, links and the primary button (Action Blue fill).
- **Approval Green** marks approved steps and a passing CI. **Refusal Red** only for refused actions.
- Graphite surfaces (`surface`, `deep`, `raise`) and 1px hairlines carry depth; no shadows, no gradients.
- The site is dark only (`appearance: force-dark`), by decision of the product owner.

## Typography

- **Hubot Sans** at width 125% for headlines (`h1` up to 6rem, steps up to 3rem, doc `h1` 2.75rem). It ties the
  site to the GitHub world the harnesses come from, with an expanded width no default UI face offers.
- **Mona Sans** for running text, 15–19px with 1.6–1.7 line height.
- **Monaspace Neon** for dates, files, commands, badges and indicator values, as Cascadia is in the app.
- All fonts are OFL, self-hosted through Fontsource; the site loads no third-party resource except the GitHub API.

## Components

- **Badge:** pill, 1px currentColor border, 7px dot, mono 12px. State is always written in words.
- **Register entry:** 76px mono date column, title over mono file, badge on the right; the current entry has a
  9% blue tint.
- **Question card:** full 1px Guard Orange border, 9% orange tint; its primary action is the download.
- **Panels and callouts:** 10px (panels) and 8px (callouts) radius, full 1px borders, never a side stripe.
- **Screenshots:** real captures of the application in dark mode, 1280×800, produced by
  `npm run site:screenshots` with the fictional demo kit.

## Versions page

`/changelog` is generated at build time from `CHANGELOG.md`, with release dates and downloads from GitHub
(Git tag dates as fallback). Each version is a register entry: expanded version number, *Latest version* badge
(green top hairline), release date in mono, chips counting each section with the count after a hairline
divider (no count on migration notes), downloads, then the sections with colored mono labels: Added green,
Changed blue, breaking/removed/security red, migration in a Guard Orange card. A sticky index of versions sits
on the left on wide screens and becomes a row of chips on narrow ones. Notes stay in English; the French page
translates the chrome and section titles.

## Documentation pages

Read mode: VitePress default layout with the tokens above, mono uppercase sidebar group titles, Hubot Sans
headings, Mona Sans body, tables that scroll inside their own bounds on narrow screens.

## Motion

Register entries and the question card rise in sequence on load (500ms, 140ms stagger) and the awaiting
badge's dot pulses, only without `prefers-reduced-motion`.
