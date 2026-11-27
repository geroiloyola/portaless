---
name: portaless-design
description: Design contract for Portaless sites. Activate whenever creating or editing themes, skins, page layouts, or applying any external design SKILL.md (such as ui-ux-pro-max, editorial, minimalist, or brutalist) to ensure full aesthetic freedom without breaking /admin/editor, the public shell, /explore/, WCAG AA contrast, or strict CSP (A-07).
---

# Portaless Design Contract

## 1. Guiding Principle — Freedom Within Invariants

Portaless separates **aesthetic expression** (100% free) from **structural & security invariants** (non-negotiable):

- **100% Free:** color palettes, typography (`--font-display`, `--font-sans`), section spacing (`--space-section`), card elevation (`--elevation`), Bento Grid composition (`layout: "bento"` + `span=2` / `featured`), asymmetric `Columns` (`ratio: "2-1"`, `"1-2"`, `"3-2"`, `"2-3"`), micro-interactions, and visual tone.
- **Non-Negotiable:** editability in `/admin/editor`, ThemePack v2 dual-mode + WCAG AA, CSS-first scoping, public header geometry, `/explore/` scope + flair architecture, and strict CSP (`A-07`).

---

## 2. Adapter Protocol for External Design Skills

When a user provides an external design `SKILL.md` (e.g., `ui-ux-pro-max`, brutalist, magazine, minimal):

1. **Translate palette & typography into `ThemePack` v2:**
   - Declare a dual-mode pack in `packages/visual-elements/src/themes/theme-pack.ts` (`lightVars` + `darkVars` + `OPTIONAL_THEME_VARS`: `--font-display`, `--font-sans`, `--space-section`, `--elevation`).
   - Never hardcode colors or fonts directly in `.astro` templates or `style="..."` block attributes.
2. **Bridge tokens via `--ve-*` and scoped CSS:**
   - Put theme-specific visual touches in `src/styles/global.css` strictly scoped under `[data-theme-pack="<name>"]`.
   - Override `--ve-card-*`, `--ve-btn-*`, `--ve-hero-*` tokens rather than fighting `elements.css` with `!important` or inline styles.
3. **Express page structure as `PageLayout` JSON:**
   - Author all pages and home layouts in `site-profiles/<profile>/home.json` and `site-profiles/<profile>/pages/*.json` using `@portaless/visual-elements` blocks (`Hero`, `FeatureGrid`, `Columns`, `PostList`, `LinkList`, `Heading`, `Paragraph`, `Spacer`, etc.).
   - Use `PageLayout.alternateLang` for bilingual pairs and `PageLayout.flairs` for `/explore/` topic tags.

---

## 3. The 6 Technical Invariants of Portaless

1. **ThemePack v2 Dual-Mode + WCAG AA (`>= 4.5:1`):**
   - Both `lightVars` and `darkVars` must pass `validateThemePack()` WCAG AA contrast (`>= 4.5:1`).
   - All 4 optional editorial tokens (`--font-display`, `--font-sans`, `--space-section`, `--elevation`) must pass `isSafeEditorialThemeValue()` (no `url()`, `expression()`, `;`, `{`, `}`, `<`, `>`).
2. **100% Editable in `/admin/editor`:**
   - Zero hardcoded page content in `.astro` files. Everything lives in `PageLayout` JSON (`site-profiles/`) and Markdown (`posts/`).
   - Every JSON must pass `validatePageLayout()` and support full `/admin/editor` round-trip (load → edit → validate → render).
3. **CSS-First & Scoped:**
   - Zero rigid inline `style="..."` in Visual Elements blocks (`elements.css` + `--ve-*` tokens handle defaults; inline `style` is reserved for dynamic per-instance values like `Spacer.height` or custom `Hero.bgColor`).
   - Respect `@media (prefers-reduced-motion: reduce)` and `:focus-visible` on all interactive controls.
4. **Predictable Public Shell & Header:**
   - Single-row navigation (`max-width: 1120px` in `.site-header-row`, fluid `nav.site-nav`, no overflow/clipping).
   - Touch targets `>= 44×44px` on mobile; never leave empty `44×44` circles on iconless mobile links.
   - Right-hand `.header-right` circular `44×44` (`border-radius: 999px`) actions: conditional `Cart` / `Navigate` (`deriveHeaderContext()`), contextual `alternateLang` (rendered **only** when the page declares a translation), `data-theme-toggle` (Claro/Oscuro), and `Share`.
   - Never add redundant manual *"Read in English / Leer en español"* buttons inside page content when `alternateLang` is present.
5. **`/explore/` Contract Intact:**
   - Preserve the 3 mandatory fixed scopes (`all`, `pages`, `publications`) before `Order by` (`top`, `confidence`, `recents`, `new`, `old`, `history`).
   - Preserve dynamic creator flairs (`PageLayout.flairs` + post frontmatter `flairs`/`flair`/`tags`) and shareable URL state (`?flair=&scope=&order=`).
6. **Strict CSP (`A-07`):**
   - `0` inline `<script>` tags, `0` inline `<style>` tags in layout overrides, `0` `on*=` event handlers.
   - Zero external font/CDN `<script>` or `<link>` requests that violate `script-src 'self'`.

---

## 4. Forbidden Anti-Patterns

- **Unrequested sidebars:** Do not wrap pages in `Columns` (`ratio: "2-1"`) to invent a permanent right-hand sidebar that breaks Portaless's clean single-column editorial flow.
- **Emojis as UI icons:** Always use SVG icons (`@portaless/visual-elements/icons` or clean inline `<svg>`), never emojis, for UI controls and cards.
- **Broken mobile collapse:** Every `FeatureGrid` (`bento` / `grid`) and `Columns` layout must collapse cleanly to 1 column on mobile (`< 720px`) with zero horizontal overflow.
- **Weakening tests:** Never relax `static-sweep.test.ts`, `security-headers.test.ts`, `theme-pack.test.ts`, or Playwright assertions to force a redesign to pass.

---

## 5. Mandatory Delivery Checklist

Before finishing any design, theme, or layout change:

1. Run `npm run verify:design` (all 5 design/CSP/theme/header/explore test suites must pass).
2. Run `PORTALESS_SITE_PROFILE=<active-profile> npm run build` and verify `0` build errors.
3. Verify `0` broken internal links, `0` inline scripts/handlers, and `validatePageLayout()` passing on all modified `site-profiles/` JSONs.
