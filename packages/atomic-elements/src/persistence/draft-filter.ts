// Politica canonica de publicacion. Toda superficie PUBLICA que consume
// PageLayout (Astro, runtime, llms.txt, feeds y exportadores) consulta esta
// decision. Admin puede leer/editar el PageStore; una URL publica no hereda
// esos privilegios.
//
// Compatibilidad: layouts antiguos sin status siguen siendo publicados. Los
// layouts nuevos deben declarar status; `private` y `draft` nunca se publican.
// El sufijo `-draft` permanece como exclusion legacy.

export interface PublicationCandidate {
  slug: string;
  status?: string;
  draft?: boolean;
  visibility?: string;
}

export type PublicationExclusionReason = "invalid_slug" | "legacy_draft_slug" | "private" | "draft" | "invalid_status";

export interface ExcludeDraftsResult {
  slugs: string[];
  skipped: number;
}

export interface ExcludeDraftPagesResult<T> {
  pages: T[];
  skipped: number;
}

/** Razón fail-closed por la que una entrada no pertenece a ninguna proyección pública. */
export function publicationExclusionReason(page: PublicationCandidate): PublicationExclusionReason | null {
  if (typeof page?.slug !== "string" || !page.slug.trim()) return "invalid_slug";
  if (page.slug.endsWith("-draft")) return "legacy_draft_slug";
  if (page.visibility === "private" || page.status === "private") return "private";
  if (page.draft === true || page.status === "draft") return "draft";
  // Ausente = published para layouts historicos. Un estado nuevo/desconocido
  // falla cerrado hasta que la politica lo entienda.
  if (page.status !== undefined && page.status !== "published") return "invalid_status";
  if (page.visibility !== undefined && page.visibility !== "public") return "private";
  return null;
}

export function isPubliclyPublishable(page: PublicationCandidate): boolean {
  return publicationExclusionReason(page) === null;
}

/** Compatibilidad semantica: distingue borrador/legacy de privado y estado invalido. */
export function isDraft(page: PublicationCandidate): boolean {
  return page.slug?.endsWith("-draft") === true || page.draft === true || page.status === "draft";
}

/** Filtra slugs legacy. Ya no existe un flag que permita publicar borradores. */
export function excludeDrafts(slugs: string[]): ExcludeDraftsResult {
  const filtered = slugs.filter((slug) => isPubliclyPublishable({ slug }));
  return { slugs: filtered, skipped: slugs.length - filtered.length };
}

/** Unico filtro para paginas y layouts que salen a una superficie publica. */
export function excludeDraftPages<T extends PublicationCandidate>(pages: T[]): ExcludeDraftPagesResult<T> {
  const kept = pages.filter(isPubliclyPublishable);
  return { pages: kept, skipped: pages.length - kept.length };
}
