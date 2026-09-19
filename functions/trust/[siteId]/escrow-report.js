// Endpoint de reporte de resultado real de transacciones -- v0.0.9.23.
// POST /trust/:siteId/escrow-report registra UN resultado de transaccion
// (transaction_outcome: completed_as_promised | refunded_no_delivery |
// disputed) reportado por un tercero de escrow autorizado -- ver
// docs/architecture/site-trust-score.md.
//
// Unica capa de autenticacion: API key por header Authorization: Bearer.
// A diferencia de agent-verification.js (que separa identidad de
// autorizacion en 2 capas porque Web Bot Auth permite que cualquiera se
// autoidentifique), aqui NO hay mecanismo de autoservicio -- Portaless
// entrega la API key manualmente, fuera de banda, la primera vez que un
// proveedor real se integra. La API key EN SI es la autorizacion: no hay
// una "identidad" separada que verificar antes.
//
// El provider_id se toma del propio body (escrowProvider), no de un
// header separado -- es el mismo campo que ya define EscrowTrustReport
// (site-trust-score.ts). isAuthorized(providerId, apiKeyHash) verifica
// que ESA combinacion especifica de proveedor+key este en la allowlist,
// no solo que la key exista en algun lado -- evita que la key de un
// proveedor autorizado bajo un nombre distinto sirva para otro.
//
// Portaless NUNCA custodia fondos -- este endpoint solo recibe y
// almacena el resultado que un tercero regulado ya determino. Ver
// ROADMAP.md, seccion "Trust Layer y Pay per Crawl: protocolo abierto,
// no asegurador".

import { hashApiKey, createAuthorizedEscrowProvidersStore } from "../../../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts";
import { createSiteTrustScoreStore } from "../../../../packages/trust-layer/src/site-trust/store-factory.ts";

const TRANSACTION_OUTCOMES = ["completed_as_promised", "refunded_no_delivery", "disputed"];

function extractBearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const siteId = params?.siteId;
  if (!siteId) {
    return new Response(JSON.stringify({ error: "missing_site_id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const apiKey = extractBearerToken(request);
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "missing_api_key",
        message: "Se requiere el header Authorization: Bearer <api_key>.",
      }),
      { status: 401, headers: { "content-type": "application/json" } }
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

  const { transactionOutcome, escrowProvider, amountCurrency } = body ?? {};

  if (typeof escrowProvider !== "string" || !escrowProvider.trim()) {
    return new Response(
      JSON.stringify({ error: "missing_escrow_provider", message: "Se requiere escrowProvider." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (!TRANSACTION_OUTCOMES.includes(transactionOutcome)) {
    return new Response(
      JSON.stringify({
        error: "invalid_transaction_outcome",
        message: `transactionOutcome debe ser una de: ${TRANSACTION_OUTCOMES.join(", ")}.`,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const apiKeyHash = await hashApiKey(apiKey);
  const authorizedEscrowProvidersStore = await createAuthorizedEscrowProvidersStore(env);
  const isAuthorized = await authorizedEscrowProvidersStore.isAuthorized(escrowProvider.trim(), apiKeyHash);

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({
        error: "provider_not_authorized",
        message: `El proveedor '${escrowProvider}' no esta autorizado, o la API key no coincide.`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createSiteTrustScoreStore(env);

  await store.recordEscrowReport({
    siteId,
    transactionOutcome,
    escrowProvider: escrowProvider.trim(),
    amountCurrency: typeof amountCurrency === "string" && amountCurrency.trim() ? amountCurrency.trim() : undefined,
    reportedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
