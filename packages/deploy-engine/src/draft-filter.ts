// Salvaguarda del publish: por defecto, un borrador nunca se publica sin que
// un humano lo revise y lo apruebe. Logica pura, extraida para poder testearla
// sin depender de PageStore ni del filesystem -- mismo principio que
// editor/tree-ops.ts y mcp-server/tools/node-ops.ts.
//
// DOS mecanismos, ambos excludos por defecto:
// 1. LEGACY: slug terminado en "-draft" (ver functions/admin/api/wizard/
//    generate-page.js y el viejo create_page del MCP, que marcaba el borrador
//    con ese sufijo hasta v0.0.9.10). Esas paginas siguen existiendo y se
//    excluyen igual; no se migran.
// 2. NATIVO: `status: "draft"` en el PageLayout (PageLayout.status, agregado
//    en v0.0.9.10). Es el mecanismo que usan create_page/update_page hoy.
//
// Un "borrador" es cualquier pagina que cumpla 1 o 2. `includeDrafts` (flag
// --include-drafts del script) los publica igual a proposito.

export interface ExcludeDraftsResult {
  slugs: string[];
  skipped: number;
}

/** Minimo que el filtro necesita saber de un layout para decidir. */
export interface DraftAwarePage {
  slug: string;
  status?: string;
}

export function isDraft(page: DraftAwarePage): boolean {
  return page.slug.endsWith("-draft") || page.status === "draft";
}

// Filtra una lista de slugs SOLO por el sufijo legacy "-draft". Se mantiene
// para quien ya tenga los slugs a mano; el publish real usa excludeDraftPages.
export function excludeDrafts(slugs: string[], includeDrafts: boolean): ExcludeDraftsResult {
  if (includeDrafts) return { slugs, skipped: 0 };
  const filtered = slugs.filter((s) => !s.endsWith("-draft"));
  return { slugs: filtered, skipped: slugs.length - filtered.length };
}

export interface ExcludeDraftPagesResult<T> {
  pages: T[];
  skipped: number;
}

// Filtra layouts por sufijo legacy "-draft" O status==="draft". Es la que usa
// publish-site.mjs, que ya tiene los layouts cargados para volcarlos.
export function excludeDraftPages<T extends DraftAwarePage>(
  pages: T[],
  includeDrafts: boolean
): ExcludeDraftPagesResult<T> {
  if (includeDrafts) return { pages, skipped: 0 };
  const kept = pages.filter((p) => !isDraft(p));
  return { pages: kept, skipped: pages.length - kept.length };
}
