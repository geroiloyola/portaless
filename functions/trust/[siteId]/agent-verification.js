// Endpoint de verificacion tecnica sobre SiteTrustScore -- v0.0.9.22.
// POST /trust/:siteId/agent-verification registra UNA verificacion de un
// agente autorizado sobre una categoria de la fuente "agent"
// (https_and_headers, structured_data_quality, machine_readable_policies,
// content_freshness, bot_traffic_anomalies -- ver
// docs/architecture/site-trust-score.md).
//
// Dos capas de seguridad DISTINTAS, en orden:
//
// 1. IDENTIDAD (verifyWebBotAuthRequest, web-bot-auth.ts): responde "¿esta
//    firma es realmente de quien dice ser?" via RFC 9421 HTTP Message
//    Signatures. Si no hay firma valida, 401 -- este endpoint, a
//    diferencia de /trust/:siteId/vote, no acepta trafico anonimo.
//
// 2. AUTORIZACION (authorized-agents.ts, tabla authorized_agents):
//    responde "¿tiene ESTE agente permiso para reportar en Portaless?".
//    Identidad verificada NO implica autorizacion -- cualquiera puede
//    generar un par Ed25519 y publicar un JWKS. Sin esta segunda capa,
//    cualquier firma valida (de CUALQUIER dominio) podria reportar
//    verified:true sobre cualquier sitio. Si el agente identificado no
//    esta en la allowlist (o esta pero active=0), 403.
//
// Solo despues de pasar ambas capas se persiste el reporte -- y se
// persiste el `verified` que el AGENTE declara sobre la categoria
// solicitada (ej. "verifique https_and_headers de este sitio y fallo"),
// que es informacion valida independientemente de si es true o false.
// El unico caso que nunca se persiste es cuando la identidad o la
// autorizacion del REPORTANTE fallan -- eso no es una señal sobre el
// sitio, es un request invalido.

import { verifyWebBotAuthRequest } from "../../../../packages/trust-layer/src/site-trust/web-bot-auth.ts";
import { createAuthorizedAgentsStore } from "../../../../packages/trust-layer/src/site-trust/authorized-agents.ts";
import { createSiteTrustScoreStore } from "../../../../packages/trust-layer/src/site-trust/store-factory.ts";

const AGENT_CATEGORIES = [
  "https_and_headers",
  "structured_data_quality",
  "machine_readable_policies",
  "content_freshness",
  "bot_traffic_anomalies",
];

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) {
    return new Response(JSON.stringify({ error: "missing_site_id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Capa 1: identidad. env.JWKS_CACHE es un KV namespace opcional -- ver
  // web-bot-auth.ts para el comportamiento sin cache (fetch directo +
  // warning, nunca falla en silencio).
  const identity = await verifyWebBotAuthRequest(request, env.JWKS_CACHE);
  if (!identity.verified || !identity.agentKeyId) {
    return new Response(
      JSON.stringify({
        error: "unauthenticated_agent",
        message: `No se pudo verificar la identidad del agente (${identity.reason ?? "razon desconocida"}).`,
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  // Capa 2: autorizacion. Identidad verificada NO es lo mismo que
  // autorizacion -- ver comentario del modulo.
  const authorizedAgentsStore = await createAuthorizedAgentsStore(env);
  const isAuthorized = await authorizedAgentsStore.isAuthorized(identity.agentKeyId);
  if (!isAuthorized) {
    return new Response(
      JSON.stringify({
        error: "agent_not_authorized",
        message: `El agente '${identity.agentKeyId}' tiene identidad valida pero no esta autorizado a reportar en Portaless.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
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

  const { category, verified, detail } = body ?? {};

  if (!AGENT_CATEGORIES.includes(category)) {
    return new Response(
      JSON.stringify({
        error: "invalid_category",
        message: `category debe ser una de: ${AGENT_CATEGORIES.join(", ")}.`,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (typeof verified !== "boolean") {
    return new Response(
      JSON.stringify({ error: "invalid_verified", message: "verified debe ser boolean." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createSiteTrustScoreStore(env);

  await store.recordAgentVerification({
    siteId,
    category,
    verified,
    detail: typeof detail === "object" && detail !== null ? detail : undefined,
    agentKeyId: identity.agentKeyId,
    verifiedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
