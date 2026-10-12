// functions/admin/api/pages.js
//
// Endpoint de listado GET /admin/api/pages (sin slug), companero de
// functions/admin/pages/[slug].js. Vive bajo /admin/api/ y no en
// /admin/pages porque esa URL es la pagina HTML del page manager
// (src/pages/admin/pages.astro -> dist/admin/pages/index.html): en
// Cloudflare Pages y en el runtime self-host, la Function gana sobre el
// estatico y /admin/pages/index.js habria respondido JSON en vez del
// manager. Mismo guard de sesion server-side que
// el resto del dashboard: requiere context.data.user (expuesto por
// functions/admin/_middleware.js), 401 si no hay sesion. No exige
// canWrite(role) porque es de solo lectura -- igual que el GET de
// [slug].js, cualquier usuario autenticado (admin o viewer) puede listar,
// solo las escrituras (PUT/DELETE) exigen rol admin.
//
// PageStore.list() ya estaba implementado end-to-end en D1PageStore y
// SqlitePageStore (packages/atomic-elements/src/persistence/stores/)
// desde v0.0.8 (SELECT slug FROM pages) -- lo unico que faltaba era este
// endpoint HTTP que lo expusiera. Por eso HttpPageStore.list() en
// src/pages/admin/editor.astro lanzaba un error explicito en vez de
// fingir un contrato que el backend no tenia todavia.
import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { data, env } = context;
  const user = data?.user;
  if (!user) {
    return json({ error: "unauthorized" }, 401);
  }

  const pageStore = await createPageStore(env);
  const slugs = await pageStore.list();

  // Phase 0.5 (page manager): ademas de los slugs, el titulo de cada
  // pagina, cargado via load() por slug (N+1 deliberado -- es un panel de
  // admin con pocas filas, no una vista publica; mantiene la interfaz
  // PageStore sin tocar).
  const pages = [];
  for (const slug of slugs) {
    try {
      const layout = await pageStore.load(slug);
      pages.push({ slug, title: layout?.title || slug });
    } catch {
      pages.push({ slug, title: slug });
    }
  }

  return json({ slugs, pages });
}
