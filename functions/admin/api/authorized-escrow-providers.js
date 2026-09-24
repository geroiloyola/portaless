// Endpoint de administracion para authorized_escrow_providers (allowlist
// de la fuente "escrow_report" de SiteTrustScore). Mismo patron de
// seguridad que functions/admin/permissions/index.js y su gemelo
// functions/admin/api/authorized-agents.js: requiere sesion valida
// (context.data.user) para GET, y canWrite(role) del lado del SERVIDOR
// para POST/PATCH.
//
// Antes de este endpoint, la UNICA forma de dar de alta un proveedor era
// scripts/onboard-escrow-provider.mjs (CLI, self-hosted only, sin
// cobertura D1). Este archivo conecta list()/grant()/revoke() de
// packages/trust-layer/src/site-trust/authorized-escrow-providers.ts a HTTP.
//
// GET  /admin/api/authorized-escrow-providers  -> { providers: AuthorizedEscrowProvider[] }
//   (nunca incluye api_key_hash -- ver rowToProvider() en el store, el
//   shape publico ya lo omite).
// POST /admin/api/authorized-escrow-providers  -> alta/actualizacion
//   (grant). A diferencia de authorized-agents, la API key NO se recibe
//   del cliente -- el store la GENERA y la devuelve en texto plano SOLO
//   en esta respuesta (apiKey). No hay ningun otro endpoint ni forma de
//   recuperarla despues -- debe copiarse y entregarse al proveedor de
//   inmediato, mismo principio que un token de API de GitHub o AWS.
// PATCH /admin/api/authorized-escrow-providers -> revocacion
//   (soft-delete, active = 0).

import { createAuthorizedEscrowProvidersStore } from "../../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts";

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

export async function onRequestGet(context) {
  const { data, env } = context;

  if (!data?.user) {
    return unauthenticated();
  }

  const store = await createAuthorizedEscrowProvidersStore(env);
  const providers = await store.list();

  return new Response(JSON.stringify({ providers }), {
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
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { providerId, displayName } = body ?? {};

  if (
    typeof providerId !== "string" ||
    !providerId ||
    typeof displayName !== "string" ||
    !displayName
  ) {
    return new Response(
      JSON.stringify({
        error: "invalid_grant_body",
        message: "Se requiere { providerId, displayName }.",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createAuthorizedEscrowProvidersStore(env);
  const { provider, apiKey } = await store.grant({
    providerId,
    displayName,
    authorizedBy: user.username,
  });

  // apiKey en texto plano -- SOLO aparece en esta respuesta. El store no
  // la persiste ni expone ningun otro camino para recuperarla despues.
  return new Response(JSON.stringify({ provider, apiKey }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPatch(context) {
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
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { providerId } = body ?? {};

  if (typeof providerId !== "string" || !providerId) {
    return new Response(
      JSON.stringify({ error: "invalid_revoke_body", message: "Se requiere { providerId }." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createAuthorizedEscrowProvidersStore(env);
  await store.revoke(providerId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
