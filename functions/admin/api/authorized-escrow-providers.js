// Endpoint de administracion para authorized_escrow_providers (allowlist
// de la fuente "escrow_report" de SiteTrustScore). Mismo patron de
// seguridad que functions/admin/permissions/index.js y su gemelo
// functions/admin/api/authorized-agents.js: requiere sesion valida
// (context.data.user) para GET, y canWrite(role) del lado del SERVIDOR
// para POST/PATCH.
//
// GET   /admin/api/authorized-escrow-providers -> { providers }
//       (nunca incluye api_key_hash; si incluye publicKeyJwk, que es publica).
// POST  /admin/api/authorized-escrow-providers -> alta/actualizacion (grant).
//       Body { providerId, displayName, publicKeyJwk? }. La API key la
//       GENERA el store y solo aparece en esta respuesta (apiKey).
// PATCH /admin/api/authorized-escrow-providers -> revocacion (active = 0).
//
// APW v1.2 (5.3, ERRATA E-4): publicKeyJwk es la clave publica Ed25519 del
// proveedor ({ kty: "OKP", crv: "Ed25519", x }), objeto o string JSON. Sin
// ella el proveedor queda autorizado pero no puede reportar (el endpoint
// exige una atestacion firmada). Re-autorizar sin publicKeyJwk conserva la
// clave que ya tenia.

import {
  createAuthorizedEscrowProvidersStore,
  INVALID_PUBLIC_KEY_JWK,
} from "../../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts";

function canWrite(role) {
  return role === "admin";
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function unauthenticated() {
  return json({ error: "unauthenticated" }, 401);
}

function forbidden(role) {
  return json({ error: "forbidden", message: `El rol '${role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return unauthenticated();

  const store = await createAuthorizedEscrowProvidersStore(env);
  const providers = await store.list();
  return json({ providers }, 200);
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
    return json({ error: "invalid_json_body" }, 400);
  }

  const { providerId, displayName, publicKeyJwk } = body ?? {};
  if (typeof providerId !== "string" || !providerId || typeof displayName !== "string" || !displayName) {
    return json({ error: "invalid_grant_body", message: "Se requiere { providerId, displayName }." }, 400);
  }

  const store = await createAuthorizedEscrowProvidersStore(env);
  let granted;
  try {
    granted = await store.grant({
      providerId,
      displayName,
      authorizedBy: user.username,
      publicKeyJwk: publicKeyJwk === undefined || publicKeyJwk === "" ? null : publicKeyJwk,
    });
  } catch (err) {
    if (err?.message === INVALID_PUBLIC_KEY_JWK) {
      return json(
        { error: "invalid_public_key_jwk", message: 'publicKeyJwk debe ser una clave publica Ed25519: { "kty": "OKP", "crv": "Ed25519", "x": "..." }.' },
        400
      );
    }
    throw err;
  }

  // apiKey en texto plano -- SOLO aparece en esta respuesta.
  return json({ provider: granted.provider, apiKey: granted.apiKey }, 200);
}

export async function onRequestPatch(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) return unauthenticated();
  if (!canWrite(user.role)) return forbidden(user.role);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { providerId } = body ?? {};
  if (typeof providerId !== "string" || !providerId) {
    return json({ error: "invalid_revoke_body", message: "Se requiere { providerId }." }, 400);
  }

  const store = await createAuthorizedEscrowProvidersStore(env);
  await store.revoke(providerId);
  return json({ ok: true }, 200);
}
