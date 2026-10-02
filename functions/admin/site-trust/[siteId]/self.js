// Endpoint ADMIN de autoevaluacion self sobre SiteTrustScore -- v0.0.9.16.
// PUT /admin/site-trust/:siteId/self declara UNA categoria de la fuente
// "self" (gdpr_compliance, privacy_policy, terms_of_service,
// payment_security, data_practices, contact_transparency -- ver
// docs/architecture/site-trust-score.md). Requiere sesion valida
// (context.data.user) y rol "admin" del lado del SERVIDOR.
//
// APW v1.2 (5.2/5.3, B3, ERRATA E-5): cada declaracion se firma como
// atestacion `self` (JWS, payload JCS) con la clave activa del sitio
// (kid did:apw:<dominio>#key-<n>). El JWS se guarda junto a la fila
// existente (attestation_jws / attestation_jti, sin store paralelo) y se
// anota en el historial encadenado. La fila es upsert por categoria: guarda
// la atestacion vigente; el historial conserva las anteriores.
//
// Si el sitio todavia no tiene identidad did:apw, la declaracion se guarda
// sin JWS (como antes) y la respuesta informa signed:false: la firma es
// aditiva y no bloquea al admin que no completo el Paso 4 del wizard.

import { createSiteTrustScoreStore } from "../../../../packages/trust-layer/src/site-trust/store-factory.ts";
import { createSiteIdentityStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { signSelfAttestation } from "../../../../packages/apw-resolver/src/did-apw/site-jws.ts";
import { recordInSiteHistory } from "../../../../packages/apw-resolver/src/did-apw/record-attestation.ts";

const SITE_ID = "default";

const SELF_CATEGORIES = [
  "gdpr_compliance",
  "privacy_policy",
  "terms_of_service",
  "payment_security",
  "data_practices",
  "contact_transparency",
];

function canDeclare(role) {
  return role === "admin";
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function signSelf(env, category, declaredValue) {
  try {
    const identityStore = await createSiteIdentityStore(env);
    const identity = await identityStore.get(SITE_ID);
    if (!identity) return { signed: false, reason: "site_identity_not_found" };
    const key = await identityStore.getActiveSigningKey(SITE_ID);
    if (!key) return { signed: false, reason: "signing_key_unavailable" };
    const { jws, jti } = await signSelfAttestation(
      { did: identity.did, category, value: declaredValue },
      { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
    );
    return { signed: true, did: identity.did, jws, jti };
  } catch (err) {
    console.warn(`[Portaless APW] No se pudo firmar la atestacion self: ${err?.message}`);
    return { signed: false, reason: "signing_error" };
  }
}

export async function onRequestPut(context) {
  const { request, data, env, params } = context;

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);

  if (!canDeclare(user.role)) {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso para declarar. Se requiere rol 'admin'.` }, 403);
  }

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { category, declaredValue, evidenceUrl } = body ?? {};

  if (!SELF_CATEGORIES.includes(category)) {
    return json({ error: "invalid_category", message: `category debe ser una de: ${SELF_CATEGORIES.join(", ")}.` }, 400);
  }
  if (typeof declaredValue !== "boolean") {
    return json({ error: "invalid_declared_value", message: "declaredValue debe ser boolean." }, 400);
  }

  // Solo el sitio propio firma sobre si mismo: siteId de la ruta debe ser el de la identidad.
  const signature = siteId === SITE_ID ? await signSelf(env, category, declaredValue) : { signed: false, reason: "not_this_site" };

  const store = await createSiteTrustScoreStore(env);
  await store.recordSelfEvaluation({
    siteId,
    category,
    declaredValue,
    evidenceUrl: typeof evidenceUrl === "string" && evidenceUrl.trim() ? evidenceUrl.trim() : undefined,
    declaredBy: user.username,
    declaredAt: new Date().toISOString(),
    attestationJws: signature.signed ? signature.jws : undefined,
    attestationJti: signature.signed ? signature.jti : undefined,
  });

  if (!signature.signed) return json({ ok: true, signed: false, reason: signature.reason }, 200);

  const history = await recordInSiteHistory(env, signature.did, signature.jws);
  return json(
    { ok: true, signed: true, jti: signature.jti, attestation: signature.jws, logged: history.logged, logReason: history.reason },
    200
  );
}
