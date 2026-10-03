// Endpoint PUBLICO de lectura de SiteTrustScore -- v0.0.9.16.
// GET /trust/:siteId devuelve el snapshot completo de las 4 fuentes para
// un sitio. Ver docs/architecture/site-trust-score.md.
//
// APW v1.2, B7 (MVP): `verification` indica como interpretar cada fuente.
// `community` es local_only. `agent`, `escrow_report` y `self` son
// verificables solo en filas con attestationJws (ERRATA E-4 y E-5).
//
// APW v1.2, B9 (6.5, ERRATA E-8): si el sitio activo una politica de lectura
// (tabla site_trust_read_policies), el snapshot solo se entrega a lectores
// que la cumplen: Web Bot Auth + identidad APW (6.3) + umbrales del Anexo A.
// Si no la cumple, responde 401 / 403 / 402 con lo que siempre es publico
// (`verification`, cantidad de filas por fuente) y el motivo. Sin politica,
// o con la politica desactivada, la respuesta es la misma de siempre: el
// valor por defecto de un sitio es publicar (A.6). Nunca abre por error:
// si la identidad del lector no se puede resolver, aplica on_fail.
//
// Pendiente: proyectar las dimensiones W publicas (W-01, W-04, W-06, W-07,
// W-09) a partir del snapshot; hoy el nivel publico son los metadatos.

import { createSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/store-factory.ts";
import { verifyWebBotAuthRequest } from "../../packages/trust-layer/src/index.ts";
import { createReadPolicyStore, toReadPolicy } from "../../packages/apw-resolver/src/scoring/read-policy-store.ts";
import { evaluatePolicy } from "../../packages/apw-resolver/src/scoring/policy.ts";
import { resolveReaderState, defaultReaderResolvers } from "../../packages/apw-resolver/src/scoring/reader-identity.ts";

const SITE_ID = "default";

const VERIFICATION = Object.freeze({
  self: {
    status: "verifiable_if_attested",
    verifiable: true,
    proofField: "attestationJws",
    reason: "Firmada por el propio sitio (JCS + EdDSA, ERRATA E-5). Atribuible, no mas confiable: sigue siendo la senal mas debil.",
  },
  agent: {
    status: "verifiable_if_attested",
    verifiable: true,
    proofField: "attestationJws",
    reason: "Solo las filas que incluyen attestationJws tienen una prueba criptográfica exportable.",
  },
  community: {
    status: "local_only",
    verifiable: false,
    reason: "MVP: voterId viene de localStorage e ipHash solo limita frecuencia; no hay identidad criptográfica ni prueba exportable del votante.",
  },
  escrow_report: {
    status: "verifiable_if_attested",
    verifiable: true,
    proofField: "attestationJws",
    reason: "Solo las filas que incluyen attestationJws tienen una prueba criptográfica exportable.",
  },
});

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

async function loadPolicy(env) {
  try {
    const store = await createReadPolicyStore(env);
    return { policy: toReadPolicy(await store.get(SITE_ID)), error: false };
  } catch (err) {
    console.warn(`[Portaless APW] No se pudo leer la politica de lectura: ${err?.message}`);
    return { policy: null, error: true };
  }
}

export async function onRequestGet(context) {
  const { env, params, request, data } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  const { policy, error } = await loadPolicy(env);
  // Si la tabla existe pero no se pudo leer, no se puede saber si hay politica: cerrar.
  if (error) return json({ error: "read_policy_unavailable" }, 503);

  const store = await createSiteTrustScoreStore(env);
  const snapshot = await store.getSnapshot(siteId);

  if (!policy) {
    return json({ ...snapshot, verification: VERIFICATION, governance: { enabled: false } }, 200);
  }

  const governedHeaders = {
    "cache-control": "private, no-store",
    vary: "Signature, Signature-Input, Signature-Agent",
  };

  // El middleware ya verifico la firma (y consumio el nonce); si no corrio, se verifica aca.
  let wba = data?.webBotAuth ?? null;
  if (!wba && request.headers.get("Signature-Agent")) {
    wba = await verifyWebBotAuthRequest(request);
  }

  const reader = await resolveReaderState(wba, defaultReaderResolvers());
  const decision = evaluatePolicy(policy, reader);

  if (decision.allow) {
    return json(
      { ...snapshot, verification: VERIFICATION, governance: { enabled: true, granted: true, reader: reader.kind === "apw_verified" ? reader.did : null } },
      200,
      governedHeaders
    );
  }

  return json(
    {
      error: "read_governed",
      reason: decision.reason,
      failed: decision.failed,
      governance: { enabled: true, granted: false },
      public: {
        siteId: snapshot.siteId,
        verification: VERIFICATION,
        counts: {
          self: snapshot.self.length,
          agent: snapshot.agent.length,
          community: snapshot.community.length,
          escrowReports: snapshot.escrowReports.length,
        },
      },
    },
    Number(decision.status),
    governedHeaders
  );
}
