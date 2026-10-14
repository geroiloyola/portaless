// functions/admin/api/element-packs.js
//
// GET /admin/api/element-packs -- devuelve los element packs instalados (la
// capa ABIERTA del catalogo de Atomic Elements, v0.0.9.11) para que el editor
// visual pueda fusionarlos con el core embebido en su bundle y mostrarlos en
// la paleta. Ver docs/architecture/element-catalog-plugins.md, seccion "El
// editor".
//
// El cliente NO recibe el catalogo resuelto (core + packs): recibe solo los
// packs. El core (elementRegistry/elementPalette) ya viaja en el bundle del
// editor, asi que alli se hace resolveCatalog(elementRegistry, elementPalette,
// packs). Esto mantiene el payload minimo y evita re-shippear el core.
//
// Mismo guard de sesion server-side que el resto del dashboard: requiere
// context.data.user (funcions/admin/_middleware.js protege /admin/*), 401 si
// no hay sesion. Es de solo lectura -- cualquier usuario autenticado puede
// listar los packs, igual que GET /admin/api/pages.
//
// El runtime self-host (server/node-runtime.mjs) auto-descubre functions/**/*.js
// y rutea por path, asi que este archivo sirve en Cloudflare Pages y en
// self-host sin registro adicional.

import { createElementPackStore } from "../../../packages/atomic-elements/src/persistence/element-pack-store-factory";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // Best-effort: si la store no puede abrirse (sin DB, entorno roto), se
  // devuelven 0 packs y el editor cae al core cerrado -- nunca 500 por esto.
  try {
    const store = await createElementPackStore(env);
    const names = await store.list();
    const packs = [];
    for (const name of names) {
      const pack = await store.get(name);
      // store.get ya valida el pack al cargar; un pack invalido es null y se
      // omite (misma leccion que catalogFromStore: no tumbar el catalogo entero).
      if (pack) packs.push(pack);
    }
    return json({ packs });
  } catch (err) {
    console.error("[element-packs] no se pudo leer la store:", err);
    return json({ packs: [] });
  }
}
