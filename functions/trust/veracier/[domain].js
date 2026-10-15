// Pagina por Veracier (APW v1.3, ERRATA E-13).
// GET /trust/veracier/:domain
//
// Publica lo que ESTE sitio guarda de las atestaciones comunitarias firmadas
// por ese emisor (did:apw:<domain>), por categoria: cantidad, promedio 1..5 y
// la ultima emision. NO publica el texto de los comentarios: A.6 los deja
// gobernados, visibles para el emisor y para lectores que cumplan la politica
// del sitio. Tampoco publica la IP ni el jti de nadie.
//
// Limite honesto: en un Portaless single-tenant cada instancia es un sitio, asi
// que esta vista muestra el historial del emisor *visto desde este sitio*. Su
// historial global vive en su propia cadena APW (5.4), que no se consulta aqui.

import { createCommunityAttestationsStore } from "../../../packages/trust-layer/src/site-trust/community-attestations.ts";

const SITE_ID = "default";
const COMMUNITY_CATEGORIES = [
  "perceived_trustworthiness",
  "content_accuracy",
  "spam_or_deceptive",
  "responsiveness",
];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function normalizeDomain(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[.]$/, "");
}

export async function onRequestGet(context) {
  const { env, params, request } = context;

  const domain = normalizeDomain(params?.domain);
  if (!domain) return json({ error: "missing_domain" }, 400);

  // Content negotiation (misma que /trust/:siteId): un navegador quiere la UI,
  // un agente o un fetch quiere el JSON.
  const accept = request?.headers?.get?.("accept") || "";
  if (accept.includes("text/html") && env?.ASSETS) {
    const shellUrl = new URL(request.url);
    shellUrl.pathname = "/trust/veracier/";
    shellUrl.search = "";
    const shell = await env.ASSETS.fetch(shellUrl);
    if (shell.ok) {
      return new Response(await shell.text(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  const iss = `did:apw:${domain}`;
  const store = await createCommunityAttestationsStore(env);
  const rows = await store.listByEmitter(iss, SITE_ID);

  const categories = {};
  for (const category of COMMUNITY_CATEGORIES) {
    const mine = rows.filter((row) => row.category === category);
    if (mine.length === 0) continue;
    const total = mine.reduce((sum, row) => sum + row.val, 0);
    categories[category] = {
      count: mine.length,
      average: Number((total / mine.length).toFixed(2)),
      lastIat: Math.max(...mine.map((row) => row.iat)),
    };
  }

  return json(
    {
      issuer: iss,
      siteId: SITE_ID,
      total: rows.length,
      categories,
      note:
        "Solo lo que este sitio registro del emisor. Los comentarios son dato gobernado (A.6) y no se publican.",
    },
    200
  );
}
