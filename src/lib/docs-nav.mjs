// Configuracion EXPLICITA del sidebar de /docs/ (grupo -> lista ordenada), no
// derivada del orden de archivos. Fuente unica: los .md que ya viven en docs/;
// el sitio es una PROYECCION de ellos, nunca una copia (docs/i18n-design.md y
// VISION: un canon, muchas proyecciones). Cada entrada declara su idioma, y el
// sidebar lo marca para que nadie se tope con un salto de idioma.
//
// `file` es relativo a la raiz del repo (docs/...). El loader de la coleccion
// (src/lib/docs-loader.mjs) lee estos mismos archivos y resuelve los enlaces
// relativos entre ellos contra `file` (src/lib/docs-links.mjs).
//
// Fuera a proposito: ROADMAP-ARCHIVE, ROADMAP_es y los documentos internos. El
// ROADMAP actual se ENLAZA (a GitHub), no se copia.

/** @typedef {{ slug: string, title: string, file: string, lang: "en" | "es" }} DocEntry */
/** @typedef {{ id: string, title: { en: string, es: string }, docs: DocEntry[] }} DocGroup */

/** @type {DocGroup[]} */
export const DOC_GROUPS = [
  {
    id: "getting-started",
    title: { en: "Getting started", es: "Primeros pasos" },
    docs: [
      { slug: "first-steps", title: "Start in 10 minutes", file: "docs/first-steps.md", lang: "es" },
      { slug: "install", title: "Install (GitHub Pages)", file: "docs/DEPLOY_GITHUB_PAGES.md", lang: "es" },
      { slug: "self-hosting", title: "Self-hosting", file: "docs/self-hosting.md", lang: "es" },
    ],
  },
  {
    id: "guides",
    title: { en: "Guides", es: "Guías" },
    docs: [
      { slug: "plugin-author", title: "Plugin author", file: "docs/plugin-author-guide.md", lang: "en" },
      { slug: "openai-compatible-provider", title: "OpenAI-compatible provider", file: "docs/openai-compatible-provider.md", lang: "en" },
      { slug: "release-acceptance", title: "Release acceptance", file: "docs/testing/release-acceptance.md", lang: "en" },
      { slug: "editor-and-pages", title: "The editor and the pages", file: "docs/architecture/content-architecture-and-use-cases.md", lang: "es" },
    ],
  },
  {
    id: "reference",
    title: { en: "Reference", es: "Referencia" },
    docs: [
      { slug: "protocol-apw", title: "Protocol APW (spec v1.3)", file: "docs/protocol-apw/APW-SPEC-v1.3.md", lang: "en" },
      { slug: "apw-vectors", title: "APW test vectors", file: "docs/protocol-apw/APW-VECTORS-v1.3.md", lang: "en" },
      { slug: "apw-starter-kit", title: "APW starter kit", file: "docs/protocol-apw/STARTER-KIT.md", lang: "en" },
      { slug: "well-known-endpoints", title: "Well-known endpoints", file: "docs/api/well-known.md", lang: "en" },
    ],
  },
  {
    id: "concepts",
    title: { en: "Concepts", es: "Conceptos" },
    docs: [
      { slug: "vision", title: "Vision", file: "docs/VISION.md", lang: "en" },
      { slug: "ecosystem-boundaries", title: "Ecosystem boundaries", file: "docs/architecture/ecosystem-boundaries.md", lang: "es" },
      { slug: "licensing-boundaries", title: "Licensing boundaries", file: "docs/architecture/licensing-boundaries.md", lang: "es" },
    ],
  },
];

/** Todas las entradas, en orden. */
export const DOC_ENTRIES = DOC_GROUPS.flatMap((g) => g.docs);

/** Patron del glob loader: paths relativos a docs/ (sin el prefijo docs/). */
export const DOC_FILES = DOC_ENTRIES.map((d) => d.file.replace(/^docs\//, ""));

/** @param {string} slug */
export function docBySlug(slug) {
  return DOC_ENTRIES.find((d) => d.slug === slug);
}
