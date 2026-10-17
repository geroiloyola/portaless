// GET /docs/<slug>.md -- markdown limpio de cada doc (misma fuente que la
// pagina HTML; los enlaces relativos se reescriben a rutas del sitio/GitHub,
// igual que en el render). Se anuncia con rel="alternate" text/markdown, como
// los posts.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_ENTRIES } from "../../lib/docs-nav.mjs";
import { rewriteMarkdownLinks } from "../../lib/docs-links.mjs";

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection("docs");
  return docs.map((entry) => ({ params: { slug: entry.id }, props: { id: entry.id } }));
};

export const GET: APIRoute = ({ props }) => {
  const { id } = props as { id: string };
  const meta = DOC_ENTRIES.find((d) => d.slug === id);
  if (!meta) return new Response("not found", { status: 404 });
  const raw = readFileSync(join(process.cwd(), meta.file), "utf8");
  const body = rewriteMarkdownLinks(raw, meta.file, import.meta.env.BASE_URL);
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
