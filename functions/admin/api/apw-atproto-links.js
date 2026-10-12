// Endpoint admin de vinculos opcionales APW <-> AT Protocol: handles AT
// que el sitio reclama en su did:apw via alsoKnownAs
// (docs/architecture/identity-atproto.md). Mismo patron de seguridad que
// functions/admin/api/mcp-agents.js: sesion (context.data.user del admin
// middleware) + canWrite(role) server-side.
//
// GET    /admin/api/apw-atproto-links -> { links: SiteAtprotoLink[] }
// POST   /admin/api/apw-atproto-links -> alta { handle } (validado con
//        resolvableHandle: sintaxis oficial AT Y TLD no reservado -- un
//        handle que jamas va a resolver no se guarda; se publica en
//        /.well-known/did.json como tambienKnownAs: ["at://<handle>"])
// DELETE /admin/api/apw-atproto-links -> baja { handle }

import { createSiteAtprotoLinksStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { resolvableHandle } from "../../../packages/identity-atproto/src/handle.ts";

const SITE_ID = "default";

function canWrite(role) {
  return role === "admin";
}

function unauthenticated() {
  return new Response(JSON.stringify({ error: "unauthenticated" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function forbidden(role) {
  return new Response(
    JSON.stringify({
      error: "forbidden",
      message: `El rol '${role}' no tiene permiso de escritura. Se requiere rol 'admin'.`,
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

function badRequest(error, message) {
  return new Response(JSON.stringify({ error, message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { data, env } = context;

  if (!data?.user) {
    return unauthenticated();
  }

  const store = await createSiteAtprotoLinksStore(env);
  const links = await store.list(SITE_ID);

  return new Response(JSON.stringify({ links }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) {
    return unauthenticated();
  }
  if (!canWrite(user.role)) {
    return forbidden(user.role);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json_body", "El cuerpo debe ser JSON valido.");
  }

  const parsed = resolvableHandle(body?.handle);
  if (!parsed.ok) {
    return badRequest("invalid_handle", `Handle AT invalido o no resoluble (${parsed.reason}). Formato: usuario.dominio.tld`);
  }

  const store = await createSiteAtprotoLinksStore(env);
  const link = await store.add(SITE_ID, parsed.handle);

  return new Response(JSON.stringify({ ok: true, link }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestDelete(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) {
    return unauthenticated();
  }
  if (!canWrite(user.role)) {
    return forbidden(user.role);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json_body", "El cuerpo debe ser JSON valido.");
  }

  const parsed = resolvableHandle(body?.handle);
  if (!parsed.ok) {
    return badRequest("invalid_handle", `Handle AT invalido (${parsed.reason}).`);
  }

  const store = await createSiteAtprotoLinksStore(env);
  const removed = await store.remove(SITE_ID, parsed.handle);

  return new Response(JSON.stringify({ ok: true, removed }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
