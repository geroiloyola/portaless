# i18n — investigation, classification and the minimal capability

Status: **investigation + classification + a minimal, honest MVP (F7).** This is
the seed of native internationalization, not a finished translation platform.
Where it and the code disagree, the code governs.

## Why this exists

`src/lib/site-lang.ts` already anticipated it: *"Hoy es una constante (el sitio
todavia no tiene i18n real); puede promoverse a un ajuste del sitio … cuando
exista negociacion de idioma."* Portaless should ship localization natively —
the same way a commerce platform ships i18n by default — so an operator reaching
an audience in another language does not have to bolt it on.

## Classification (VISION.md's rule that decides what gets built)

| Piece | Class | Why |
|---|---|---|
| **Locale-aware routes + i18next-format resources + `hreflang`** | `ENABLE` | Removes a real barrier for the next participant (an operator publishing to more than one language). Small, reusable, no provider. |
| **Per-locale content collections** (every page/post in N languages) | `ENABLE` | The same barrier, one level up. Build it when a site actually needs it, not before. |
| **Machine translation that fills a locale automatically** | `GATED` | Needs an external provider, a quality bar and, above all, a **declared provenance** — a machine translation is *declared information* (VISION), never verified. Nothing in the core may depend on a provider staying in business. |
| **A full TMS / glossary / review workflow** | `OUT OF CORE` | A specialist product; the core exposes the format, not the process. |

**Do not build the network before the need.** The MVP ships the *shape*
(locales, resources, routes) and a real second language for the home; the
machine-translation half stays gated behind a provider and a provenance rule.

## The decision: i18next **format**, not an i18next dependency

i18next is the de-facto shape for translation resources (nested keys,
`{{var}}` interpolation, one JSON per locale). Portaless adopts that **format**
so that a translator, a TMS, or an existing i18next toolchain can produce the
files with no conversion — but the core resolves them with a **tiny pure
resolver** and ships **no runtime dependency**. This is the same boundary as the
plugin SDK (compatibility without a coupling) and it keeps the static build
dependency-free.

Resource shape (`src/i18n/<locale>.json`), i18next-compatible:

```json
{
  "nav": { "posts": "Posts", "docs": "Docs" },
  "home": { "switch": "Español" },
  "cta": { "start": "Start in {{minutes}} minutes" }
}
```

## One canon, many locale projections

A locale is a **projection** of the canon, exactly like a page or a feed: the
canon is the source, the locale is derived, and when they disagree the canon
wins. This decides the model:

- **UI strings** (chrome) live in `src/i18n/<locale>.json` and are resolved by
  `t(locale, key)`.
- **Content** stays a `PageLayout`; a translated page is a *sibling layout*
  (`home.json` = the English canon, `home.es.json` = its Spanish projection),
  rendered by the same engine. The translation is content, so it lives with the
  content, not in the string catalogue.
- **Provenance is recorded, not assumed.** A locale produced by a machine must
  say so (the same discipline as `declaredOrigin` on Cloud Images). The MVP's
  Spanish home is a **human** translation; a machine one is future work and must
  carry that label.

## The MVP (F7)

1. `src/lib/i18n.ts` — pure: `LOCALES`, `DEFAULT_LOCALE`, `t(locale, key, vars)`
   with fallback to the default locale, `localePath(locale, path)`,
   `hreflangAlternates(path)`. No dependency.
2. `src/i18n/{en,es}.json` — the UI-string catalogue, i18next format.
3. The home in two locales: `/` (English canon) and `/es/` (Spanish projection),
   both rendered by `renderPage` from a `PageLayout` — nothing hand-written.
4. `hreflang` alternate links in `<head>` and the `/es/` entry in the sitemap.
5. A locale switcher on the home (contained there; the header/footer keep their
   runtime-shell parity untouched in this pass).

## Honest limits

- Only the **home** is localized in this pass. The rest of the demo (blog,
  `beta`, docs) is still Spanish or English as it was; the design supports
  localizing them, the content is not translated.
- **No machine translation.** Filling a locale automatically is gated on a
  provider and on a provenance rule that does not exist yet.
- **No automatic locale negotiation** (Accept-Language / geo). The locale is a
  route (`/`, `/es/`), which works on the static demo; negotiation is future.
- The default locale is `en` at `/`; the site chrome elsewhere still uses
  `SITE_LANG` (es). Unifying them is a follow-up, noted here so it is not
  mistaken for a finished state.
- **The `/docs/` site is not localized**: each document lives in one language
  (its own), so the sidebar and the page header **declare that language** per
  document (`src/lib/docs-nav.mjs`) instead of pretending to a locale that does
  not exist. Docs are a projection of the Markdown in `docs/`, not a translated
  catalogue.

## The language control is conditional on real coverage

The language control does **not** assume the site is bilingual; it reads the
data:

- **A page with a real translation** (home, Explore — they pass `alternatePath`
  to `BaseLayout`) shows the **switcher pill**, which links to the *same* route
  in the other locale.
- **A page without one** (blog, docs, pages, trust, …) shows **no pill** — a
  language icon that silently drops you at the other-locale *home* is a
  downgrade, not a translation. Instead it shows a **one-line notice** (the
  Airbnb pattern: *"This page is only available in one language."* + *"See the
  site in Spanish"*), which is honest about what exists and offers the other
  locale's entry point.
- **A single-locale site** (`LOCALES.length === 1`) shows neither: there is
  nothing to offer. The guard is `isMultilingual()`, and `otherLocales()` is
  the primitive that does **not** assume exactly two locales.

The notice **never says "Translate"**: automatic machine translation is `GATED`
above (it needs a provider and a declared-provenance rule), so the notice only
states coverage and links to what is really there.

## Content pages are localized by URL (one version per locale)

A content page (`src/content/pages/*.json`) declares its language through the
**file name**, not a mandatory field:

- `<slug>.json` → the **primary** version, at `/pages/<slug>/`;
- `<slug>.<locale>.json` → a **translation**, at `/<locale>/pages/<slug>/`.

`src/lib/content-pages.ts` groups the files by slug (`parsePagePath` /
`groupContentPages`), and the two routes (`paginas/[slug].astro` for the primary,
`[locale]/pages/[slug].astro` for the translations) render the shared
`ContentPage.astro`. A page with a translation gets the **switcher pill** to the
*same page* in the other language (its `languageAlternate`), `hreflang`
alternates for every version, and its own `<html lang>`; a page without one gets
the notice above. **The primary's language is the page's own** (the file's
`locale`, or `SITE_LANG`): the plain URL is the page's home language and the
prefixed URLs are its translations — so a Spanish-authored page exposes English
at `/en/…` and vice versa. This is what makes the language control *translate the
current view* instead of dropping the reader at another page.

Known limit: the runtime shell (`functions/pages/[slug].js`, which serves
pages edited from the panel and stored in D1) does not carry the translation
mapping yet, so on a node a panel-edited page shows the notice; the static build
(the demo, and any static host) resolves the versions from the files.
