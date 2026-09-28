// functions/admin/pages/index.js
//
// Endpoint de listado GET /admin/pages (sin slug), companero de
// functions/admin/pages/[slug].js. Mismo guard de sesion server-side que
// el resto del dashboard: requiere context.data.user (expuesto por
// functions/admin/_middleware.js), 401 si no hay sesion. No exige
// canWrite(role) porque es de solo lectura -- igual que el GET de
// [slug].js, cualquier usuario autenticado (admin o viewer) puede listar,
// solo las escrituras (PUT) exigen rol admin.
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

  return json({ slugs });
}
