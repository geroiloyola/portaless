// Reescritura de enlaces relativos de los docs. Un doc enlaza a otro con
// `./APW-SPEC-v1.3.md` o a un archivo del repo con `../packages/x.ts`. En el
// sitio esas rutas NO existen: este modulo las traduce a
//   - ruta del sitio `/docs/<slug>/` si el destino es uno de los docs incluidos
//     (configuracion en docs-nav.mjs), o
//   - URL de GitHub (blob/tree) si es cualquier otro archivo del repo.
// Asi la fuente sigue siendo UNICA (el Markdown de docs/) y el sitio es una
// proyeccion, con los enlaces resueltos y sin rutas rotas.
//
// Se aplica en el loader de contenido (docs-loader.mjs) antes de guardar el
// body, asi el render del Markdown ya sale con los enlaces resueltos y no hace
// falta ningun plugin del procesador (Astro 7 ya no trae remark por defecto).
import path from "node:path";
import { DOC_ENTRIES } from "./docs-nav.mjs";

const REPO = "https://github.com/geroiloyola/portaless";
const BLOB = `${REPO}/blob/main`;
const TREE = `${REPO}/tree/main`;
const BY_FILE = new Map(DOC_ENTRIES.map((d) => [d.file, d]));

/**
 * @param {string} href
 * @param {string} repoRel ruta del doc actual relativa a la raiz (docs/...)
 * @param {string} base base de Astro (ej. /portaless/)
 */
export function rewriteHref(href, repoRel, base) {
  if (!href || /^(https?:|mailto:|tel:|#|\/)/.test(href)) return href;
  const hashIdx = href.indexOf("#");
  const anchor = hashIdx >= 0 ? href.slice(hashIdx) : "";
  let target = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  if (!target) return href; // solo ancla

  // `archivo.ts:712` (estilo GitHub) -> `archivo.ts#L712`.
  let lineAnchor = "";
  const lineMatch = target.match(/^(.*\.\w+):(\d+)$/);
  if (lineMatch) {
    target = lineMatch[1];
    lineAnchor = `#L${lineMatch[2]}`;
  }

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repoRel), target));
  const doc = BY_FILE.get(resolved);
  if (doc) return `${base.replace(/\/$/, "")}/docs/${doc.slug}/${anchor}`;

  const isDir = !/\.[a-z0-9]+$/i.test(resolved);
  return `${isDir ? TREE : BLOB}/${resolved}${lineAnchor || anchor}`;
}

/** Reescritura sobre texto Markdown crudo (la aplica el loader y la version .md). */
export function rewriteMarkdownLinks(markdown, repoRel, base) {
  return markdown.replace(/\]\((\.\.?\/[^)\s]+)\)/g, (_m, href) => `](${rewriteHref(href, repoRel, base)})`);
}
