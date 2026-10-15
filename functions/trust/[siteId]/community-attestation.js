// Endpoint de atestacion comunitaria firmada (APW v1.3, 5.3 y ERRATA E-13).
// POST /trust/:siteId/community-attestation
//
// Reemplaza al voto anonimo como fuente que PUNTUA. El cuerpo trae la
// atestacion JWS; el emisor (el Veracier) es un did:apw:<dominio> cuya
// identidad se resuelve con 5.1 (TXT `_apw.<dominio>` con `k` + did.json) y
// cuya firma se verifica con el mismo `verifyAttestation` que usa 5.3 para
// las demas fuentes. `val` es un entero 1..5 porque `src` es `community`.
//
// Sin firma valida no se registra nada: el criterio de salida de la Fase 8 es
// que ningun voto se emita sin firma, y hoy lo unico que acotaba al votante era
// un rate-limit por IP hasheada.
//
// E-13 (emisor distinto, antiguedad minima y min_weight) se aplica al PUNTUAR,
// no al registrar: aca solo se captura `emitterFirstSeenIat` (la primera entrada
// verificada del historial del emisor, 5.4) para que el scoring sea puro.

import { createCommunityAttestationsStore, DUPLICATE_COMMUNITY_JTI } from "../../../packages/trust-layer/src/site-trust/community-attestations.ts";
import { verifyAttestation } from "../../../packages/trust-layer/src/site-trust/attestation.ts";
import { resolveApwIdentity } from "../../../packages/apw-resolver/src/index.ts";
import { resolveApwHistory } from "../../../packages/apw-resolver/src/did-apw/history-resolver.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";

const COMMUNITY_CATEGORIES = [
  "perceived_trustworthiness",
  "content_accuracy",
  "spam_or_deceptive",
  "responsiveness",
];

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const APW_DID_PREFIX = "did:apw:";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Lee el `iss` del payload SIN verificar la firma: solo para saber a quien resolver. */
function peekIssuer(jws) {
  const payloadPart = String(jws).split(".")[1];
  if (!payloadPart) return null;
  const base64 = payloadPart.split("-").join("+").split("_").join("/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const payload = JSON.parse(atob(padded));
  return typeof payload?.iss === "string" ? payload.iss : null;
}

/**
 * Primera entrada verificada del historial del emisor, en segundos (5.4).
 * Devuelve null si no se puede resolver: el emisor entonces no acredita
 * antiguedad (fail-closed, E-13).
 */
async function emitterFirstSeenIat(domain) {
  try {
    const history = await resolveApwHistory(domain, fetch, { includeEntries: true });
    if (!history?.verified || !Array.isArray(history.attestations) || history.attestations.length === 0) return null;
    let earliest = null;
    for (const ref of history.attestations) {
      const t = Date.parse(ref?.ts);
      if (Number.isFinite(t) && (earliest === null || t < earliest)) earliest = t;
    }
    return earliest === null ? null : Math.floor(earliest / 1000);
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const jws = body?.attestation;
  if (typeof jws !== "string" || !jws.trim()) {
    return json(
      { error: "missing_attestation", message: "Se requiere `attestation`: el JWS firmado por el emisor (did:apw)." },
      401
    );
  }

  let iss;
  try {
    iss = peekIssuer(jws.trim());
  } catch {
    return json({ error: "malformed_attestation" }, 400);
  }
  if (typeof iss !== "string" || !iss.startsWith(APW_DID_PREFIX)) {
    return json({ error: "invalid_issuer", message: "`iss` debe ser un did:apw:<dominio>." }, 400);
  }
  const emitterDomain = iss.slice(APW_DID_PREFIX.length);

  const identity = await resolveApwIdentity(emitterDomain, fetch);
  if (!identity.verified || !identity.didDocument) {
    return json({ error: "issuer_unresolvable", reason: identity.reason }, 403);
  }
  const publicKeyJwk = identity.didDocument.verificationMethod?.[0]?.publicKeyJwk;

  const sub = `${APW_DID_PREFIX}${siteId}`;
  const verified = await verifyAttestation(jws.trim(), publicKeyJwk, { sub, src: "community", iss: identity.did });
  if (!verified.ok) {
    return json({ error: "invalid_attestation", reason: verified.reason }, 400);
  }

  const claims = verified.claims;
  if (!COMMUNITY_CATEGORIES.includes(claims.cat)) {
    return json(
      { error: "invalid_category", message: `cat debe ser una de: ${COMMUNITY_CATEGORIES.join(", ")}.` },
      400
    );
  }

  const receivedAt = new Date().toISOString();
  const store = await createCommunityAttestationsStore(env);

  // 5.3 paso 6: `jti` unico por emisor. Se chequea ANTES del rate-limit: un
  // reenvio exacto es un duplicado (409), no un abuso de frecuencia (429).
  if (await store.has(claims.iss, claims.jti)) {
    return json(
      { error: "duplicate_attestation", message: "Ese `jti` ya fue registrado por este emisor (5.3, paso 6)." },
      409
    );
  }

  // Rate-limit por identidad, no por IP: un emisor puede actualizar su voto,
  // pero no inundar la tabla (1 por categoria cada 24h).
  const previous = await store.listByEmitter(claims.iss, siteId);
  const now = Date.parse(receivedAt);
  const tooSoon = previous.some(
    (row) => row.category === claims.cat && now - Date.parse(row.receivedAt) < RATE_LIMIT_WINDOW_MS
  );
  if (tooSoon) {
    return json(
      { error: "rate_limited", message: "Ya emitiste una atestacion para esta categoria en las ultimas 24 horas." },
      429
    );
  }

  const firstSeen = await emitterFirstSeenIat(emitterDomain);

  try {
    await store.record({
      iss: claims.iss,
      jti: claims.jti,
      siteId,
      sub,
      category: claims.cat,
      val: claims.val,
      iat: claims.iat,
      jws: jws.trim(),
      emitterFirstSeenIat: firstSeen,
      receivedAt,
    });
  } catch (err) {
    if (String(err?.message) === DUPLICATE_COMMUNITY_JTI) {
      return json(
        { error: "duplicate_attestation", message: "Ese `jti` ya fue registrado por este emisor (5.3, paso 6)." },
        409
      );
    }
    throw err;
  }

  // Fase 10: se registra en el feed de actividad del sitio. El actor es el
  // emisor (did:apw), no una IP; no se guarda el texto de nada.
  await emitActivity(env, {
    kind: "community.attestation",
    actor: claims.iss,
    subject: siteId,
    detail: claims.cat,
  });

  return json(
    {
      ok: true,
      attestation: {
        iss: claims.iss,
        jti: claims.jti,
        category: claims.cat,
        val: claims.val,
        iat: claims.iat,
        emitterFirstSeenIat: firstSeen,
      },
    },
    200
  );
}
