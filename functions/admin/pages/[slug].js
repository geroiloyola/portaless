// Endpoint de referencia: PUT /admin/pages/:slug guarda un PageLayout de
// Atomic Elements. Es el primer endpoint de escritura del dashboard que
// valida canWrite(role) del lado del SERVIDOR -- no solo en la UI.
//
// CONTEXTO: el guard DOM-level agregado en packages/dashboard/src/security/
// role-guard.ts es defensa en profundidad en el cliente (deshabilita
// controles), pero un viewer que llamara este endpoint directamente con
// curl/fetch, saltandose la UI, podria escribir igual si el servidor no
// valida. Este archivo es la referencia a replicar en cualquier otro
// endpoint de escritura del dashboard (permisos, configuracion, etc.).
//
// Requiere que la sesion ya haya sido validada por functions/admin/_middleware.js
// (que corre antes, para toda la ruta /admin/*) y que ese middleware deje
// disponible el usuario autenticado en context.data (patron estandar de
// Cloudflare Pages Functions).
//
// v0.0.8: NOTA IMPORTANTE PARA REVISION MANUAL -- el contenido real de
// functions/admin/_middleware.js no pudo leerse en ninguna de las sesiones
// de trabajo (bug del conector get_file_contents, documentado en
// .airchive/project_memory/lessons_learned.md, seccion 7). Este PR ASUME
// que ese middleware ya expone `context.data.user` (igual que
// functions/_middleware.js, el middleware global del Trust Layer, que usa
// el mismo patron de context.data en Cloudflare Pages Functions). Verificar
// manualmente antes de mergear: si _middleware.js de /admin/* NO asigna
// `context.data.user = user;` antes de `return next();`, hay que agregarlo
// ahi o este endpoint (y cualquiera que repita este patron) recibira
// siempre 401 aunque la sesion sea valida.
//
// v0.0.8: se conecta el PageStore real via createPageStore(context.env),
// que elige D1PageStore (Cloudflare Pages, env.PORTALESS_DB) o
// SqlitePageStore (self-hosted) -- mismo patron que packages/permissions y
// packages/trust-layer/src/ledger. Ambas implementaciones cumplen la
// interfaz PageStore ya existente en
// packages/atomic-elements/src/persistence/page-store.ts (load/save/list),
// la misma que usa LocalStoragePageStore en el editor cliente. Antes, GET
// devolvia siempre 501 "not_implemented" y PUT solo validaba sin persistir.

import { validatePageLayout } from "../../../packages/atomic-elements/src/persistence/page-schema";
import { createPageStore } from "../../../packages/atomic-elements/src/persistence/store-factory";

function canWrite(role) {
  return role === "admin";
}

export async function onRequestPut(context) {
  const { request, params, data, env } = context;

  const user = data?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!canWrite(user.role)) {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  let layout;
  try {
    layout = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (layout?.slug !== params.slug) {
    return new Response(
      JSON.stringify({ error: "slug_mismatch", message: "El slug de la URL no coincide con el del body." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const validation = validatePageLayout(layout);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: "invalid_page_layout", details: validation.errors }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const pageStore = await createPageStore(env);
  await pageStore.save(layout);

  return new Response(JSON.stringify({ ok: true, slug: layout.slug }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { data, params, env } = context;
  if (!data?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const pageStore = await createPageStore(env);
  const layout = await pageStore.load(params.slug);

  if (!layout) {
    return new Response(JSON.stringify({ error: "not_found", slug: params.slug }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify(layout), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
