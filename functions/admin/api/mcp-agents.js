// Endpoint de administracion de tokens de agentes MCP (identidad por
// invocacion del servidor MCP via transporte HTTP, Opcion B -- ver
// AGENT.md y docs/architecture/mcp-agents.md). Mismo patron de seguridad
// que functions/admin/api/authorized-agents.js: sesion valida
// (context.data.user, expuesta por functions/admin/_middleware.js) y
// canWrite(role) del lado del SERVIDOR para POST/PATCH -- un viewer que
// llame este endpoint directo con curl/fetch no puede escribir.
//
// GET   /admin/api/mcp-agents -> { tokens: McpAgentTokenRecord[] } (nunca plaintexts)
// POST  /admin/api/mcp-agents -> emite/rota el token de un agente; el
//       plaintext se devuelve UNA sola vez en la respuesta
//       ({ ok, token, record }) -- no se persiste (solo su hash sha256)
//       ni se vuelve a mostrar.
// PATCH /admin/api/mcp-agents -> revoca TODOS los tokens activos de un
//       agente ({ ok, revoked }); revoked=false si no habia ninguno.
//
// Emite el mismo formato que generateMcpAgentToken() en
// packages/mcp-server/src/permissions/agent-token-store.ts
// (pless_mcp_...). El cliente MCP remoto lo configura como header
// "Authorization: Bearer <token>".

import { createMcpAgentTokenStore } from "../../../packages/mcp-server/src/permissions/agent-token-store.ts";

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

  const store = await createMcpAgentTokenStore(env);
  const tokens = await store.list();

  return new Response(JSON.stringify({ tokens }), {
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

  const { agentKeyId, displayName } = body ?? {};

  if (typeof agentKeyId !== "string" || !agentKeyId || typeof displayName !== "string" || !displayName) {
    return badRequest("invalid_issue_body", "Se requiere { agentKeyId, displayName }.");
  }

  const store = await createMcpAgentTokenStore(env);
  // issue() rota: revoca cualquier token activo previo del mismo
  // agentKeyId antes de emitir el nuevo.
  const { token, record } = await store.issue({ agentKeyId, displayName });

  return new Response(JSON.stringify({ ok: true, token, record }), {
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
    return badRequest("invalid_json_body", "El cuerpo debe ser JSON valido.");
  }

  const { agentKeyId } = body ?? {};

  if (typeof agentKeyId !== "string" || !agentKeyId) {
    return badRequest("invalid_revoke_body", "Se requiere { agentKeyId }.");
  }

  const store = await createMcpAgentTokenStore(env);
  const revoked = await store.revoke(agentKeyId);

  return new Response(JSON.stringify({ ok: true, revoked }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
