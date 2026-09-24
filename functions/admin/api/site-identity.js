// functions/admin/api/site-identity.js
//
// Endpoint del Paso 3-4 del Wizard de onboarding: genera (o consulta) la
// identidad did:apw de ESTE sitio. Mismo patron de seguridad que
// functions/admin/api/authorized-escrow-providers.js: requiere sesion
// valida (context.data.user) para GET, y canWrite(role) del lado del
// SERVIDOR para POST.

import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { generateApwDid } from "../../../packages/apw-resolver/src/did-apw/generate.ts";

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
    JSON.stringify({ error: "forbidden", message: `El rol '${role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return unauthenticated();

  const store = await createSiteIdentityStore(env);
  const identity = await store.get(SITE_ID);

  return new Response(JSON.stringify({ identity }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return unauthenticated();
  if (!canWrite(user.role)) return forbidden(user.role);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const { domain } = body ?? {};
  if (typeof domain !== "string" || !domain.trim()) {
    return new Response(
      JSON.stringify({ error: "invalid_body", message: "Se requiere { domain }." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createSiteIdentityStore(env);
  const existing = await store.get(SITE_ID);
  if (existing) {
    return new Response(
      JSON.stringify({
        error: "identity_already_exists",
        message: "Este sitio ya tiene una identidad did:apw generada. La rotacion de claves no esta implementada todavia.",
        identity: existing,
      }),
      { status: 409, headers: { "content-type": "application/json" } }
    );
  }

  const keyPair = await generateApwDid(domain);
  const record = await store.create(SITE_ID, keyPair, user.username);

  return new Response(
    JSON.stringify({ identity: record, didDocument: keyPair.didDocument, privateKeyJwk: keyPair.privateKeyJwk }),
    { status: 201, headers: { "content-type": "application/json" } }
  );
}
