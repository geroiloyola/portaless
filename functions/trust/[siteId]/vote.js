// Endpoint PUBLICO de voto community sobre SiteTrustScore -- v0.0.9.19.
// POST /trust/:siteId/vote registra UN voto (1-5) de un visitante humano
// sobre una categoria de la fuente "community" (perceived_trustworthiness,
// content_accuracy, spam_or_deceptive, responsiveness -- ver
// docs/architecture/site-trust-score.md). Sin sesion: a diferencia del
// voto de plugins (functions/admin/plugins/[pluginId]/vote.js, que exige
// rol admin porque vota sobre PLUGINS instalados por el propio operador),
// votar sobre la confianza de un SITIO es una atestacion de visitante --
// no requiere cuenta Portaless, igual que una resena de producto.
//
// v0.0.9.19: agrega rate-limiting server-side por IP. voterId (localStorage,
// client-side) sigue existiendo para el ON CONFLICT que sobrescribe el
// voto de un mismo navegador, pero YA NO es la unica defensa -- borrar
// localStorage y generar un voterId nuevo no alcanza para eludir el
// limite, porque isRateLimited() chequea por ip_hash, no por voterId.
//
// La IP llega via el header CF-Connecting-IP (canonico en Cloudflare
// Pages/Workers, siempre presente) -- NO x-forwarded-for, que Cloudflare
// no garantiza en el mismo formato. Se hashea con SHA-256 + salt antes de
// persistir; la IP cruda nunca toca el store. El salt viene de
// env.IP_HASH_SALT -- si no esta configurado, se usa un salt fijo de
// desarrollo con warning explicito (nunca falla en silencio, pero tampoco
// bloquea el voto por falta de configuracion en un entorno de prueba).
//
// La ventana es de 24h y el limite es 1 voto por IP por sitio+categoria --
// suficiente para que el ataque de inflar el propio community score sea
// "mas molesto que util", ya que community es la señal mas debil de las
// 4 por diseño (atestacion, no verificacion ni ground truth). No pretende
// ser criptograficamente robusto.

import { createSiteTrustScoreStore } from "../../../packages/trust-layer/src/site-trust/store-factory.ts";

const COMMUNITY_CATEGORIES = [
  "perceived_trustworthiness",
  "content_accuracy",
  "spam_or_deceptive",
  "responsiveness",
];

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEV_FALLBACK_SALT = "portaless-dev-salt-configure-IP_HASH_SALT";

async function hashIp(ip, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${ip}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

  const clientIp = request.headers.get("CF-Connecting-IP");
  if (!clientIp) {
    return new Response(
      JSON.stringify({ error: "missing_client_ip", message: "No se pudo determinar la IP del visitante." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const salt = env.IP_HASH_SALT;
  if (!salt) {
    console.warn(
      "[Portaless SiteTrustScore] IP_HASH_SALT no configurado -- usando salt de desarrollo. Configuralo en produccion."
    );
  }
  const ipHash = await hashIp(clientIp, salt ?? DEV_FALLBACK_SALT);

  const store = await createSiteTrustScoreStore(env);

  const limited = await store.isRateLimited(siteId, category, ipHash, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Ya se registro un voto para esta categoria desde esta red en las ultimas 24 horas.",
      }),
      { status: 429, headers: { "content-type": "application/json" } }
    );
  }

  const vote = await store.recordCommunityVote({
    siteId,
    category,
    score,
    comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
    voterId: voterId.trim(),
    ipHash,
    votedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, vote: { ...vote, ipHash: undefined } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
