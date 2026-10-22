# Portaless home — design contract (Phase 0)

The home at `/` is Portaless's own first real use case: a landing page built
**entirely with the Atomic Elements engine** (a `PageLayout` JSON rendered by
`renderPage`), not hand-written HTML. This document is the contract the phases
below implement. Where it and the code disagree, the code governs.

Reference: [`astro.build`](https://astro.build/) as a **friend project** — we
take its *patterns* (dark canvas, oversized gradient headline, glow, glass
cards, generous spacing, a monumental closing CTA), never its assets, copy or
branding. Portaless's own palette and voice are the source of truth
([`design-guide.md`](./design-guide.md)).

## Audience and language

- Copy in **English** (the home speaks to the international reader; the rest of
  the demo stays Spanish).
- **Dark-only**: the home sets its own theme pack; the visitor's light/dark
  toggle still governs every other page.

## Narrative

Portaless exists because **the owner is never the one holding the state**. The
home tells that in three beats, in this order:

1. **You own the state.** A sovereign node: identity, content, policy, evidence
   — yours, portable, self-hosted.
2. **The machines are answered.** You decide, from the panel, who may read your
   site — search engines, AI assistants, model training — and the site answers
   **in writing**. (This is the §12.4 sentence; it MUST remain on the home.)
3. **Extensions stop being the most dangerous thing.** Third-party code runs in
   a sandbox, granted one capability at a time.

## Section wireframe

| # | Section | Element(s) | Honesty rule |
|---|---|---|---|
| 1 | Hero | `Hero` (variant `spotlight`) + 2 `Button` | No number, no logo wall, no "trusted by". |
| 2 | Real proof strip | `Paragraph` + links | Only real, checkable links: GitHub, docs, APW spec, live demo. |
| 3 | Four pillars | `FeatureGrid` | Each pillar maps to shipped code; no roadmap item sold as done. |
| 4 | "This home is Portaless" | `Heading` + `Paragraph` + `Icon` | Meta and true: it is a JSON of elements. |
| 5 | Latest posts | `PostList` | Real posts, same canonical filter as `/blog`, RSS, `llms.txt`. |
| 6 | Store teaser | `ProductGrid`/`StoreBlock` | Rendered only when commerce is enabled; otherwise absent (no fake catalog). |
| 7 | FAQ | `FAQ` | Answers state real limits (installer flag off, 5 of 12 plugin capabilities still `501`, single maintainer). |
| 8 | Closing CTA | `Hero` (minimal) + `Button` | Points at the 10-minute install guide. |

The header and footer are **not** part of the layout: they come from
`BaseLayout` (footer parity with the runtime shell is test-fixed).

## Technical approach

- **Theme pack `portaless-nocturno`** sets the 16 allowlisted CSS variables to a deep
  dark palette with the official accents (`#C5D86D`, `#F05D23`). A theme pack is
  data-only and can only set those 16 vars (`theme-pack.ts`), so it cannot carry
  arbitrary CSS.
- **Ambient effects live in `global.css`**, scoped by `[data-theme-pack="portaless-nocturno"]`:
  page background gradient, a subtle grid/glow layer (`body::before`), gradient
  headline (`background-clip:text` on the spotlight hero title), and glass on
  the new elements' cards. These are page-level, CSS-only, and never override
  the elements' inline styles (they only add properties inline styles do not
  set: backgrounds on `body`, `backdrop-filter`, pseudo-elements).
- **New elements** carry their own classes (`ae-icon`, `ae-feature-grid`,
  `ae-post-list`) so the ambient CSS can target them without touching the
  byte-identical renders of the existing elements.
- **No per-element motion/hover controls.** ROADMAP Phase 13 declared them out
  of scope; the home's motion, if any, is ambient CSS honoring
  `prefers-reduced-motion`.
- **No third-party JS.** Static build, works on GitHub Pages under `/portaless/`.
- Adding elements updates the MCP schema automatically (its enum derives from
  `elementRegistry`), so parity holds without touching the MCP server.

## Constraints

- No fabricated metrics, testimonials, logos or "trusted by".
- No new runtime dependency; no external fonts beyond `fonts.css`.
- Contrast AA on the dark canvas (accent used as text is the light accent).
- The home must stay reachable and honest on the static demo (no `functions/`).
