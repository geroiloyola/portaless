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
// Cloudflare Pages Functions). Si tu _middleware.js actual no hace esto
// todavia, hay que agregarle `context.data.user = user;` antes de
// `return next();` -- lo dejo señalado en el PR para revision manual,
// porque no pude leer el contenido exacto de ese archivo en esta sesion.

import { validatePageLayout } from "../../../packages/atomic-elements/src/persistence/page-schema";

function canWrite(role) {
  return role === "admin";
}

export async function onRequestPut(context) {
  const { request, params, data } = context;

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

  return new Response(JSON.stringify({ ok: true, slug: layout.slug }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { data } = context;
  if (!data?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "not_implemented", message: "Conectar al PageStore real para lectura." }), {
    status: 501,
    headers: { "content-type": "application/json" },
  });
}
