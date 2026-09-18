// Endpoint PUBLICO de voto community sobre SiteTrustScore -- v0.0.9.16.
// POST /trust/:siteId/vote registra UN voto (1-5) de un visitante humano
// sobre una categoria de la fuente "community" (perceived_trustworthiness,
// content_accuracy, spam_or_deceptive, responsiveness -- ver
// docs/architecture/site-trust-score.md). Sin sesion: a diferencia del
// voto de plugins (functions/admin/plugins/[pluginId]/vote.js, que exige
// rol admin porque vota sobre PLUGINS instalados por el propio operador),
// votar sobre la confianza de un SITIO es una atestacion de visitante --
// no requiere cuenta Portaless, igual que una resena de producto.
//
// voterId es una huella anonima generada del lado del cliente (ver
// src/pages/trust/[siteId].astro para el mecanismo real -- hoy no
// implementado, ver limitaciones), NO una identidad verificada. Este
// endpoint NO intenta prevenir voto multiple ni abuso -- ON CONFLICT
// sobrescribe el voto anterior del mismo voterId+categoria (ver
// recordCommunityVote en ambos stores), pero nada impide generar un
// voterId nuevo por request. Rate-limiting/anti-abuso real queda fuera
// de alcance de este commit, documentado como limitacion honesta.

import { createSiteTrustScoreStore } from "../../../packages/trust-layer/src/site-trust/store-factory.ts";

const COMMUNITY_CATEGORIES = [
  "perceived_trustworthiness",
  "content_accuracy",
  "spam_or_deceptive",
  "responsiveness",
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

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { category, score, comment, voterId } = body ?? {};

  if (!COMMUNITY_CATEGORIES.includes(category)) {
    return new Response(
      JSON.stringify({
        error: "invalid_category",
        message: `category debe ser una de: ${COMMUNITY_CATEGORIES.join(", ")}.`,
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return new Response(
      JSON.stringify({ error: "invalid_score", message: "score debe ser un entero entre 1 y 5." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  if (typeof voterId !== "string" || !voterId.trim()) {
    return new Response(
      JSON.stringify({ error: "missing_voter_id", message: "Se requiere voterId (huella anonima del visitante)." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const store = await createSiteTrustScoreStore(env);

  const vote = await store.recordCommunityVote({
    siteId,
    category,
    score,
    comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
    voterId: voterId.trim(),
    votedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, vote }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
