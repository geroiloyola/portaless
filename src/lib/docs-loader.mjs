// Loader de contenido propio para los docs. Lee el Markdown de docs/ (la fuente
// unica), reescribe los enlaces relativos a rutas del sitio/GitHub y guarda el
// body ya resuelto MAS su HTML renderizado. Astro 7 ya no trae el procesador de
// remark por defecto, asi que en vez de agregar una dependencia se transforma la
// fuente ANTES de guardarla -- el render del Markdown sale con los enlaces
// resueltos y no hace falta ningun plugin del procesador.
//
// Un loader propio NO renderiza solo: hay que llamar a `renderMarkdown` del
// contexto y guardar `rendered` (es lo que hace el loader `glob` por dentro);
// sin eso `render(entry)` devuelve un componente vacio.
//
// Solo se cargan los archivos de la configuracion explicita (docs-nav.mjs); el
// id de cada entrada es su slug de la config, no la ruta del archivo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DOC_ENTRIES } from "./docs-nav.mjs";
import { rewriteMarkdownLinks } from "./docs-links.mjs";

function stripFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const after = text.indexOf("\n", end + 4);
  return after === -1 ? "" : text.slice(after + 1);
}

export function docsLoader({ base = "/" } = {}) {
  return {
    name: "portaless-docs-loader",
    load: async ({ store, parseData, renderMarkdown }) => {
      for (const doc of DOC_ENTRIES) {
        const filePath = join(process.cwd(), doc.file);
        const body = rewriteMarkdownLinks(stripFrontmatter(readFileSync(filePath, "utf8")), doc.file, base);
        const data = await parseData({ id: doc.slug, data: { title: doc.title }, filePath: doc.file });
        const rendered = await renderMarkdown(body, { fileURL: pathToFileURL(filePath) });
        store.set({ id: doc.slug, data, body, filePath: doc.file, rendered });
      }
    },
  };
}
