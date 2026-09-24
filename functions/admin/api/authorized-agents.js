// Endpoint de administracion para authorized_agents (allowlist de la
// fuente "agent" de SiteTrustScore). Mismo patron de seguridad que
// functions/admin/permissions/index.js: requiere sesion valida
// (context.data.user, expuesta por functions/admin/_middleware.js) para
// GET, y canWrite(role) del lado del SERVIDOR para POST/PATCH -- un
// viewer que llame este endpoint directo con curl/fetch, saltandose la
// UI, no puede escribir igual.
//
// Antes de este endpoint, la UNICA forma de dar de alta un agente era
// scripts/onboard-agent.mjs (CLI, self-hosted only, sin cobertura D1).
// Este archivo conecta list()/grant()/revoke() de
// packages/trust-layer/src/site-trust/authorized-agents.ts a HTTP.
//
// GET  /admin/api/authorized-agents           -> { agents: AuthorizedAgent[] }
// POST /admin/api/authorized-agents           -> alta/actualizacion (grant)
// PATCH /admin/api/authorized-agents          -> revocacion (soft-delete,
//   active = 0) -- PATCH en vez de DELETE porque no se borra la fila,
//   solo cambia su estado (misma semantica que un PATCH de estado en
//   cualquier API REST).

import { createAuthorizedAgentsStore } from "../../../packages/trust-layer/src/site-trust/authorized-agents.ts";

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

  const store = await createAuthorizedAgentsStore(env);
  const agents = await store.list();

  return new Response(JSON.stringify({ agents }), {
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

  const { agentKeyId, signatureAgentUrl, displayName, keyAlgorithm } = body ?? {};

  if (
    typeof agentKeyId !== "string" ||
    !agentKeyId ||
    typeof signatureAgentUrl !== "string" ||
    !signatureAgentUrl ||
    typeof displayName !== "string" ||
    !displayName
  ) {
    return new Response(
      JSON.stringify({
        error: "invalid_grant_body",
        message: "Se requiere { agentKeyId, signatureAgentUrl, displayName, keyAlgorithm? }.",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createAuthorizedAgentsStore(env);
  await store.grant({
    agentKeyId,
    signatureAgentUrl,
    displayName,
    authorizedBy: user.username,
    keyAlgorithm,
  });

  return new Response(JSON.stringify({ ok: true }), {
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

  const { agentKeyId } = body ?? {};

  if (typeof agentKeyId !== "string" || !agentKeyId) {
    return new Response(
      JSON.stringify({ error: "invalid_revoke_body", message: "Se requiere { agentKeyId }." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createAuthorizedAgentsStore(env);
  await store.revoke(agentKeyId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
