// Endpoint de reporte de resultado real de transacciones -- v0.0.9.23.
// POST /trust/:siteId/escrow-report registra UN resultado de transaccion
// (transaction_outcome: completed_as_promised | refunded_no_delivery |
// disputed) reportado por un tercero de escrow autorizado -- ver
// docs/architecture/site-trust-score.md.
//
// Autenticacion: API key por header Authorization: Bearer. Portaless
// entrega la API key manualmente, fuera de banda. isAuthorized(providerId,
// apiKeyHash) verifica que ESA combinacion especifica de proveedor+key este
// en la allowlist.
//
// APW v1.2 (5.3, ERRATA E-4): la API key autentica la llamada, pero no deja
// una prueba que un tercero pueda verificar. Ahora el body trae
// `attestation`: un JWS compacto firmado por el proveedor con su clave
// Ed25519 registrada (public_key_jwk), con iss = escrowProvider,
// sub = did:apw:<siteId>, src = "escrow_report", cat = transactionOutcome,
// val = true. Sin clave registrada, 403; si el JWS no verifica, 400
// invalid_attestation; si no coincide con el cuerpo plano, 400
// attestation_mismatch; si el jti ya se uso, 409. El JWS se guarda con la
// fila y se anota en el historial encadenado del sitio.
//
// Portaless NUNCA custodia fondos -- este endpoint solo recibe y
// almacena el resultado que un tercero regulado ya determino. Ver
// ROADMAP.md, seccion "Trust Layer y Pay per Crawl: protocolo abierto,
// no asegurador".

import { hashApiKey, createAuthorizedEscrowProvidersStore } from "../../../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts";
import { createSiteTrustScoreStore } from "../../../../packages/trust-layer/src/site-trust/store-factory.ts";
import { DUPLICATE_ATTESTATION_JTI } from "../../../../packages/trust-layer/src/site-trust/site-trust-score.ts";
import { verifyAttestation } from "../../../../packages/trust-layer/src/site-trust/attestation.ts";
import { recordInSiteHistory } from "../../../../packages/apw-resolver/src/did-apw/record-attestation.ts";

const TRANSACTION_OUTCOMES = ["completed_as_promised", "refunded_no_delivery", "disputed"];

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function extractBearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  const apiKey = extractBearerToken(request);
  if (!apiKey) {
    return json({ error: "missing_api_key", message: "Se requiere el header Authorization: Bearer <api_key>." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { transactionOutcome, escrowProvider, amountCurrency, attestation } = body ?? {};

  if (typeof escrowProvider !== "string" || !escrowProvider.trim()) {
    return json({ error: "missing_escrow_provider", message: "Se requiere escrowProvider." }, 400);
  }
  if (!TRANSACTION_OUTCOMES.includes(transactionOutcome)) {
    return json(
      { error: "invalid_transaction_outcome", message: `transactionOutcome debe ser una de: ${TRANSACTION_OUTCOMES.join(", ")}.` },
      400
    );
  }

  const providerId = escrowProvider.trim();
  const apiKeyHash = await hashApiKey(apiKey);
  const providersStore = await createAuthorizedEscrowProvidersStore(env);
  const isAuthorized = await providersStore.isAuthorized(providerId, apiKeyHash);
  if (!isAuthorized) {
    return json(
      { error: "provider_not_authorized", message: `El proveedor '${providerId}' no esta autorizado, o la API key no coincide.` },
      403
    );
  }

  if (typeof attestation !== "string" || !attestation) {
    return json(
      { error: "missing_attestation", message: "Se requiere body.attestation: JWS firmado por el proveedor (APW v1.2, 5.3)." },
      400
    );
  }

  const publicKeyJwk = await providersStore.getPublicKeyJwk(providerId);
  if (!publicKeyJwk) {
    return json(
      {
        error: "provider_without_public_key",
        message: "El proveedor no tiene una clave publica registrada. Un admin debe cargarla antes de que pueda reportar.",
      },
      403
    );
  }

  const subject = `did:apw:${String(siteId).toLowerCase()}`;
  const result = await verifyAttestation(attestation, publicKeyJwk, { sub: subject, src: "escrow_report", iss: providerId });
  if (!result.ok) return json({ error: "invalid_attestation", reason: result.reason }, 400);

  if (result.claims.cat !== transactionOutcome || result.claims.val !== true) {
    return json(
      { error: "attestation_mismatch", message: "transactionOutcome debe coincidir con cat, y val debe ser true." },
      400
    );
  }

  const store = await createSiteTrustScoreStore(env);
  try {
    await store.recordEscrowReport({
      siteId,
      transactionOutcome,
      escrowProvider: providerId,
      amountCurrency: typeof amountCurrency === "string" && amountCurrency.trim() ? amountCurrency.trim() : undefined,
      reportedAt: new Date().toISOString(),
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
