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
import { createCommunityAttestationsStore } from "../../packages/trust-layer/src/site-trust/community-attestations.ts";
import { verifyWebBotAuthRequest } from "../../packages/trust-layer/src/index.ts";
import { createReadPolicyStore, toReadPolicy } from "../../packages/apw-resolver/src/scoring/read-policy-store.ts";
import { evaluatePolicy, projectTrustView } from "../../packages/apw-resolver/src/scoring/policy.ts";
import { scoreSiteDimensions } from "../../packages/apw-resolver/src/scoring/site-dimensions.ts";
import { buildSiteSvriDetail } from "../../packages/apw-resolver/src/scoring/svri.ts";
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
    status: "mixed_per_entry",
    verifiable: true,
    proofField: "signed",
    reason: "Cada fila indica signed: true si es una atestación did:apw verificada al ingreso, o false si es una opinión legacy sin firma. Las opiniones legacy no puntúan.",
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

// Privacidad de la fuente community. `ip_hash` es un artefacto interno de
// rate-limit y `voter_id` es un UUID anonimo que genera el navegador; ninguno
// de los dos es dato de protocolo: 6.6 publica el puntaje, la cantidad y la
// suma de pesos, y el Anexo A.6 nunca nombra la IP ni el identificador del
// votante. Se depuran de TODA respuesta publica por dos motivos concretos:
// enumerar votantes y correlacionarlos entre sitios, y revertir la IP por
// fuerza bruta contra el espacio IPv4 si el salt es debil (2^32 hashes).
//
// Se usa una lista blanca y no un borrado de campos: asi un campo nuevo que se
// agregue a la fila en el futuro no se filtra por olvido.
function publicCommunityRows(rows) {
  return (rows ?? []).map((row) => ({
    siteId: row.siteId,
    category: row.category,
    score: row.score,
    // signed is provenance metadata for presentation; it is true only for
    // rows loaded from the signature-verified append-only attestation store.
    signed: Boolean(row.iss),
    comment: row.comment,
    votedAt: row.votedAt,
  }));
}

function toPublicSnapshot(snapshot) {
  return { ...snapshot, community: publicCommunityRows(snapshot.community) };
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

// E-13: las atestaciones comunitarias firmadas viven en su propio store
// append-only, no en el snapshot del SiteTrustScore. Se normalizan a la forma
// de fila que entiende el scoring. Si el store falla, la proyeccion sigue con
// lo que haya: la respuesta nunca se cae por esto.
async function loadCommunityAttestations(env, siteId) {
  try {
    const store = await createCommunityAttestationsStore(env);
    const rows = await store.listBySite(siteId);
    return rows.map((row) => ({
      category: row.category,
      score: row.val,
      iss: row.iss,
      jti: row.jti,
      attestationJws: row.jws,
      iat: row.iat,
      votedAt: row.receivedAt,
      emitterFirstSeenIat: row.emitterFirstSeenIat,
    }));
  } catch (err) {
    console.warn(`[Portaless APW] Sin atestaciones comunitarias para ${siteId}: ${err?.message}`);
    return [];
  }
}

export async function onRequestGet(context) {
  const { env, params, request, data } = context;

  const siteId = params?.siteId;
  if (!siteId) return json({ error: "missing_site_id" }, 400);

  // Content negotiation (Phase 1): un navegador (Accept: text/html) quiere
  // la UI de SiteTrustScore; agentes y fetchers de API quieren el JSON del
  // snapshot. Sin esto la Function ganaba al estatico en self-host y
  // Cloudflare Pages (las funciones corren antes que los assets) y una
  // persona que abria /trust/<siteId> veia JSON crudo. La UI vive en un
  // UNICO shell estatico /trust/ (src/pages/trust/index.astro, que lee el
  // siteId del pathname en el navegador: la URL sigue siendo
  // /trust/<siteId> porque esta Function es la que responde esa ruta) y se
  // sirve via env.ASSETS (binding existente en Cloudflare Pages y en el
  // runtime Node self-host). fetch() de la propia UI usa Accept */* ->
  // sigue cayendo al JSON de abajo. Si no hay ASSETS binding, o el shell
  // no existe, se responde JSON como antes.
  const accept = request?.headers?.get?.("accept") || "";
  if (accept.includes("text/html") && env?.ASSETS) {
    const shellUrl = new URL(request.url);
    shellUrl.pathname = "/trust/";
    shellUrl.search = "";
    const shell = await env.ASSETS.fetch(shellUrl);
    if (shell.ok) {
      const html = await shell.text();
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  const { policy, publicOverrides, error } = await loadPolicy(env);
  // Si la tabla existe pero no se pudo leer, no se puede saber si hay politica: cerrar.
  if (error) return json({ error: "read_policy_unavailable" }, 503);

  const store = await createSiteTrustScoreStore(env);
  const snapshot = await store.getSnapshot(siteId);
  // E-13: las atestaciones comunitarias firmadas se agregan al snapshot antes
  // de puntuar. Las filas sin `iss` (opinion de visitante) siguen viajando como
  // dato publico, pero el scoring las ignora.
  const attested = await loadCommunityAttestations(env, siteId);
  const scoringSnapshot = { ...snapshot, community: [...(snapshot.community ?? []), ...attested] };
  const publicSnapshot = toPublicSnapshot(scoringSnapshot);
  const siteScores = loadSiteScores(scoringSnapshot);
  let siteEvidence = null;
  try {
    siteEvidence = buildSiteSvriDetail(scoringSnapshot).evidence;
  } catch (err) {
    console.warn(`[Portaless SVRI] Sin proyeccion SVRI para ${siteId}: ${err?.message}`);
  }
  const projection = (governedAllowed) =>
    siteScores ? projectTrustView(siteScores, governedAllowed, publicOverrides, siteEvidence ?? undefined) : undefined;

  if (!policy) {
    return json(
      {
        ...publicSnapshot,
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
        ...publicSnapshot,
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
          community: scoringSnapshot.community.length,
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
