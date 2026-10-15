/**
 * Seguridad de renderizado de contenido remoto (Fase 9b). El contenido de un par
 * es NO confiable: se valida antes de que toque el DOM.
 *
 *  - Esquema de URL: solo http/https. Se rechaza `javascript:`, `data:`,
 *    `file:`, `blob:` y cualquier otra cosa. Un `href` remoto es exactamente
 *    donde se cruza esa linea.
 *  - Cap de items: un par no puede inflar la pagina con miles de entradas.
 *  - No `set:html`: el contrato vive en quien consume; aca se entrega texto
 *    plano validado, nunca HTML.
 *  - Nunca se mezcla en `llms.txt`: esa es una decision del emisor, no del
 *    agregador (documentada en el endpoint, no aca).
 */

/** Cap por defecto de entradas remotas renderizadas de un par. */
export const MAX_REMOTE_ITEMS = 50;
/** Cap total del feed agregado. */
export const MAX_AGGREGATE_ITEMS = 500;

const SAFE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** true si la URL es un enlace http/https con host; false para cualquier otro esquema. */
export function isSafeRemoteUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0 || url.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return false;
  return parsed.hostname.length > 0;
}

/** Recorta a `n` items (>=0). No muta. */
export function capItems<T>(items: readonly T[], n = MAX_REMOTE_ITEMS): T[] {
  const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return items.length > limit ? items.slice(0, limit) : [...items];
}

/** Texto para render: se fuerza a string y se recorta; nunca HTML. */
export function toPlainText(value: unknown, max = 500): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max) : s;
}
