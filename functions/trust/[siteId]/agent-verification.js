// Endpoint de verificacion tecnica sobre SiteTrustScore -- v0.0.9.22.
// POST /trust/:siteId/agent-verification registra UNA verificacion de un
// agente autorizado sobre una categoria de la fuente "agent"
// (https_and_headers, structured_data_quality, machine_readable_policies,
// content_freshness, bot_traffic_anomalies -- ver
// docs/architecture/site-trust-score.md).
//
// Dos capas de seguridad DISTINTAS, en orden:
//
// 1. IDENTIDAD (verifyWebBotAuthRequest, web-bot-auth.ts): responde "esta
//    firma es realmente de quien dice ser?" via RFC 9421 HTTP Message
//    Signatures. Si no hay firma valida, 401 -- este endpoint, a
//    diferencia de /trust/:siteId/vote, no acepta trafico anonimo.
//
// 2. AUTORIZACION (authorized-agents.ts, tabla authorized_agents):
//    responde "tiene ESTE agente permiso para reportar en Portaless?".
//    Identidad verificada NO implica autorizacion. Si el agente
//    identificado no esta en la allowlist (o esta pero active=0), 403.
//
// APW v1.2 (5.3, ERRATA E-4) -- tercera capa, ATESTACION: la firma HTTP de
// Web Bot Auth cubre @authority y signature-agent, no el cuerpo, asi que el
// `verified` del body viajaba sin autenticar. Ahora el body trae
// `attestation`: un JWS compacto firmado con la MISMA clave Ed25519 del
// directorio del agente (kid = keyid de la firma HTTP), con
// iss = origen Signature-Agent, sub = did:apw:<siteId>, src = "agent",
// cat = category, val = verified. Si el JWS no verifica, 400
// invalid_attestation; si no coincide con el cuerpo plano, 400
// attestation_mismatch; si el jti ya se uso, 409. El JWS se guarda con la
// fila y se anota en el historial encadenado del sitio.
//
// El unico caso que nunca se persiste es cuando la identidad, la
// autorizacion o la atestacion del REPORTANTE fallan -- eso no es una
// senal sobre el sitio, es un request invalido.
//
// Rutas de import: este archivo esta a tres niveles de la raiz del repo
// (functions/trust/[siteId]/), asi que el prefijo es ../../../packages/.

import {
  verifyWebBotAuthRequest,
  resolveAgentDirectoryKey,
  parseSignatureAgent,
} from "../../../packages/trust-layer/src/site-trust/web-bot-auth.ts";
import { createAuthorizedAgentsStore } from "../../../packages/trust-layer/src/site-trust/authorized-agents.ts";
import { createSiteTrustScoreStore } from "../../../packages/trust-layer/src/site-trust/store-factory.ts";
import { DUPLICATE_ATTESTATION_JTI } from "../../../packages/trust-layer/src/site-trust/site-trust-score.ts";
import { verifyAttestation } from "../../../packages/trust-layer/src/site-trust/attestation.ts";
import { recordInSiteHistory } from "../../../packages/apw-resolver/src/did-apw/record-attestation.ts";

const AGENT_CATEGORIES = [
  "https_and_headers",
  "structured_data_quality",
  "machine_readable_policies",
  "content_freshness",
  "bot_traffic_anomalies",
];

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  // Capa 1: identidad.
  const identity = await verifyWebBotAuthRequest(request, env.JWKS_CACHE);
  if (!identity.verified || !identity.agentKeyId) {
    return json(
      {
        error: "unauthenticated_agent",
        message: `No se pudo verificar la identidad del agente (${identity.reason ?? "razon desconocida"}).`,
      },
      401
    );
  }

  // Capa 2: autorizacion.
  const authorizedAgentsStore = await createAuthorizedAgentsStore(env);
  const isAuthorized = await authorizedAgentsStore.isAuthorized(identity.agentKeyId);
  if (!isAuthorized) {
    return json(
      {
        error: "agent_not_authorized",
        message: `El agente '${identity.agentKeyId}' tiene identidad valida pero no esta autorizado a reportar en Portaless.`,
      },
      403
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { category, verified, detail, attestation } = body ?? {};

  if (!AGENT_CATEGORIES.includes(category)) {
    return json({ error: "invalid_category", message: `category debe ser una de: ${AGENT_CATEGORIES.join(", ")}.` }, 400);
  }
  if (typeof verified !== "boolean") {
    return json({ error: "invalid_verified", message: "verified debe ser boolean." }, 400);
  }
  if (typeof attestation !== "string" || !attestation) {
    return json(
      { error: "missing_attestation", message: "Se requiere body.attestation: JWS firmado por el agente (APW v1.2, 5.3)." },
      400
    );
  }

  // Capa 3: atestacion, con la clave del directorio del agente.
  const signatureAgent = parseSignatureAgent(request.headers.get("Signature-Agent") ?? "");
  if (!signatureAgent) return json({ error: "unauthenticated_agent", message: "Signature-Agent invalido." }, 401);

  let directoryKey = null;
  try {
    directoryKey = await resolveAgentDirectoryKey(signatureAgent, identity.agentKeyId, env.JWKS_CACHE);
  } catch {
    directoryKey = null;
  }
  if (!directoryKey) {
    return json({ error: "attestation_key_unavailable", message: "No se pudo leer la clave del directorio del agente." }, 401);
  }

  const subject = `did:apw:${String(siteId).toLowerCase()}`;
  const result = await verifyAttestation(attestation, directoryKey, {
    sub: subject,
    src: "agent",
    iss: signatureAgent,
    kid: identity.agentKeyId,
  });
  if (!result.ok) return json({ error: "invalid_attestation", reason: result.reason }, 400);

  if (result.claims.cat !== category || result.claims.val !== verified) {
    return json(
      { error: "attestation_mismatch", message: "category y verified deben coincidir con cat y val de la atestacion firmada." },
      400
    );
  }

  const store = await createSiteTrustScoreStore(env);
  try {
    await store.recordAgentVerification({
      siteId,
      category,
      verified,
      detail: typeof detail === "object" && detail !== null ? detail : undefined,
      agentKeyId: identity.agentKeyId,
      verifiedAt: new Date().toISOString(),
      attestationJws: attestation,
      attestationJti: result.claims.jti,
    });
  } catch (err) {
    if (err?.message === DUPLICATE_ATTESTATION_JTI) {
      return json({ error: "duplicate_attestation", message: "Esa atestacion (jti) ya fue registrada." }, 409);
    }
    throw err;
  }

  const history = await recordInSiteHistory(env, subject, attestation);
  return json({ ok: true, logged: history.logged }, 200);
}
