// functions/llms.txt.js — Phase 6 (publication maturity).
//
// GET /llms.txt: fusiona en runtime las paginas editadas en la tabla
// `pages` (D1/SQLite) sobre el archivo que emite el build. Antes de esto
// un sitio self-hosted creaba una pagina desde el editor, el visitante la
// veia en /paginas/<slug> al instante, pero los agentes no podian
// descubrirla: llms.txt solo listaba src/content/pages/*.json. Era el
// mismo hueco del sitemap, un poco peor porque llms.txt es el artefacto
// pensado exactamente para ese descubrimiento.
//
// Fallback honesto (mismo patron que functions/paginas/[slug].js, al
// reves): si no hay base de datos, si esta vacia, o si el build estatico
// no existe, se sirve el estatico con context.next() -- GitHub Pages no
// tiene functions y nunca llega a este archivo.
//
// Limites documentados:
//   - solo se agrega la seccion "Páginas del editor"; los posts y las
//     paginas del build quedan tal cual los genera Astro;
//   - si la politica del sitio bloquea ai_input, el build lo marca con el
//     sentinel y este archivo NO agrega nada: la política del dueño manda
//     sobre la disponibilidad tecnica;
//   - el sitemap NO se toca aqui (sigue listando solo el build); hacerlo
//     es el mismo patron en functions/sitemap.xml.js y queda pendiente;
//   - tope de 200 paginas listadas: un sitio con miles de filas no debe
//     pagar N queries en cada GET de un archivo de descubrimiento.

import { createPageStore } from "../packages/atomic-elements/src/persistence/store-factory.ts";
import { validatePageLayout } from "../packages/atomic-elements/src/persistence/page-schema.ts";
import {
  joinSiteUrl,
  mergeDbPagesIntoLlmsTxt,
} from "../src/lib/llms-txt.ts";
import { ROUTES } from "../src/lib/routes.ts";

const MAX_DB_PAGES = 200;

/** Paginas validas de la base: slug + titulo/description del layout. */
async function loadDbPages(env) {
  const store = await createPageStore(env);
  const slugs = (await store.list()).slice(0, MAX_DB_PAGES);
  const pages = [];
  for (const slug of slugs) {
    const layout = await store.load(slug);
    if (!layout) continue;
    if (!validatePageLayout(layout).valid) continue;
    pages.push({ slug: layout.slug || slug, title: layout.title, description: layout.description });
  }
  return pages;
}

export async function onRequestGet(context) {
  const { env, request, next } = context;

  let pages = [];
  try {
    pages = await loadDbPages(env);
  } catch {
    // Sin base de datos (deploy estatico puro) o error de lectura: sirve
    // el build estatico, nunca 500 en un archivo publico de descubrimiento.
    return next();
  }
  if (pages.length === 0) return next();

  const base = await next();
  if (!base.ok) return base;

  const text = await base.text();
  // El site URL en runtime puede diferir del build (proxy, dominio
  // propio): PORTALESS_SITE_URL manda si esta; si no, el origen pedido.
  const siteUrl = env.PORTALESS_SITE_URL || new URL(request.url).origin;
  const basePath = env.PORTALESS_BASE_PATH || "/";
  const merged = mergeDbPagesIntoLlmsTxt(text, pages, (slug) =>
    joinSiteUrl(siteUrl, basePath, `${ROUTES.PAGES}/${slug}`)
  );

  return new Response(merged, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
