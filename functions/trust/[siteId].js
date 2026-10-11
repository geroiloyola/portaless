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
// APW v1.3, 6.5: excepcion por lector. Un grant `trust:read-governance-bypass`
// del Centro de Permisos sobre el DID del lector (subject "reader") deja
// pasar ese lector aunque no cumpla los umbrales. No salta la identidad:
// exige un lector apw_verified; si la tabla de grants no se puede leer, el
// bypass simplemente no se aplica (el lector sigue contra la politica).
//
// APW v1.3, 6.6 (A.6): la respuesta trae `projection` con las dimensiones W
// del sitio calculadas del snapshot (Anexo A.2/A.4). Al rechazar, la
// proyeccion vive en `public.projection` y `dimensions` solo contiene el
// conjunto publico (W-01, W-04, W-06, W-07, W-09); `aggregates` trae
// puntaje, cantidad y suma de pesos de TODAS las dimensiones del sitio. Al
// permitir, `projection` esta arriba con las dimensiones gobernadas
// incluidas (`governed: "granted"`). El nivel publico nunca se oculta.

import { createSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/store-factory.ts";
import { verifyWebBotAuthRequest } from "../../packages/trust-layer/src/index.ts";
import { createReadPolicyStore, toReadPolicy } from "../../packages/apw-resolver/src/scoring/read-policy-store.ts";
import { evaluatePolicy, projectTrustView } from "../../packages/apw-resolver/src/scoring/policy.ts";
import { scoreSiteDimensions } from "../../packages/apw-resolver/src/scoring/site-dimensions.ts";
import { resolveReaderState, defaultReaderResolvers } from "../../packages/apw-resolver/src/scoring/reader-identity.ts";
import { createPermissionStore } from "../../packages/permissions/src/store-factory.ts";
import { hasReadGovernanceBypass } from "../../packages/permissions/src/reader-bypass.ts";

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
    const record = await store.get(SITE_ID);
    // publicOverrides (A.6): dimensiones gobernadas que el dueno volvio
    // publicas. No cambia la politica: cambia lo que se proyecta al rechazar.
    return { policy: toReadPolicy(record), publicOverrides: record?.publicOverrides ?? [], error: false };
  } catch (err) {
    console.warn(`[Portaless APW] No se pudo leer la politica de lectura: ${err?.message}`);
    return { policy: null, publicOverrides: [], error: true };
  }
}

// Dimensiones W del sitio (A.2/A.4) -> A.6. La proyeccion es metadata de la
// respuesta, nunca la decide: si algo falla se omite y la respuesta sigue
// siendo la de siempre (403 con `public`, o 200 con el snapshot).
function loadSiteScores(snapshot) {
  try {
    return scoreSiteDimensions(snapshot);
  } catch (err) {
    console.warn(`[Portaless APW] Sin proyeccion de dimensiones para ${snapshot?.siteId}: ${err?.message}`);
    return null;
  }
}

export async function onRequestGet(context) {
  const { env, params, request, data } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  const { policy, publicOverrides, error } = await loadPolicy(env);
  // Si la tabla existe pero no se pudo leer, no se puede saber si hay politica: cerrar.
  if (error) return json({ error: "read_policy_unavailable" }, 503);

  const store = await createSiteTrustScoreStore(env);
  const snapshot = await store.getSnapshot(siteId);
  const siteScores = loadSiteScores(snapshot);
  const projection = (governedAllowed) =>
    siteScores ? projectTrustView(siteScores, governedAllowed, publicOverrides) : undefined;

  if (!policy) {
    return json(
      {
        ...snapshot,
        verification: VERIFICATION,
        governance: { enabled: false },
        projection: projection(true),
      },
      200
    );
  }

  const governedHeaders = {
    "cache-control": "private, no-store",
    vary: "Signature, Signature-Input, Signature-Agent",
  };

  // El middleware ya verifico la firma (y consumio el nonce); si no corrio, se verifica aca.
  let wba = data?.webBotAuth ?? null;
  if (!wba && request.headers.get("Signature-Agent")) {
    wba = await verifyWebBotAuthRequest(request, { env });
  }

  const reader = await resolveReaderState(wba, defaultReaderResolvers());

  // Excepcion por lector (6.5): un grant del Centro de Permisos sobre el DID
  // del lector salta los umbrales. Solo aplica a un lector con identidad APW
  // verificada; si el store de grants no se puede leer, no hay bypass (y el
  // lector sigue evaluandose contra la politica de siempre).
  let bypass = false;
  if (reader.kind === "apw_verified") {
    try {
      bypass = await hasReadGovernanceBypass(await createPermissionStore(env), reader.did);
    } catch (err) {
      console.warn(`[Portaless APW] Centro de Permisos ilegible para el bypass de ${reader.did}: ${err?.message}`);
      bypass = false;
    }
  }

  const decision = evaluatePolicy(policy, reader, { bypass });

  if (decision.allow) {
    return json(
      {
        ...snapshot,
        verification: VERIFICATION,
        governance: {
          enabled: true,
          granted: true,
          ...(bypass ? { bypass: true } : {}),
          reader: reader.kind === "apw_verified" ? reader.did : null,
        },
        projection: projection(true),
      },
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
        // 6.6: el nivel publico completo, no solo los metadatos.
        projection: projection(false),
      },
    },
    Number(decision.status),
    governedHeaders
  );
}
