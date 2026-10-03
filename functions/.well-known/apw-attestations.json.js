// GET /.well-known/apw-attestations.json -- contenido de las atestaciones del
// historial encadenado (APW v1.2, 5.4 y 6.4; ERRATA E-9).
//
// apw-log.json publica entradas firmadas que contienen solo el HASH (att) de
// cada atestacion. Este endpoint publica el JWS del emisor de cada entrada:
//   { seq, att, jws }   jws es null en entradas anteriores a E-9.
// Un verificador comprueba que base64url(SHA-256(jws)) === att y que esa
// entrada este en la cadena verificada de apw-log.json. Por eso este archivo no
// necesita firma propia: no puede agregar ni cambiar nada sin romper el hash.
//
// Regla de completitud (E-9): quien evalua a este sitio como lector exige que
// cada att de la cadena tenga su jws aqui. Ocultar una atestacion negativa ya
// anotada (policy_violation, redistribution) no es posible sin que se note.
//
// Paginado igual que apw-log.json: ?from=<seq> (default 1) y ?limit=<n>
// (default 100, max 500). Ruta publica: /.well-known/* pasa por
// isPublicBotRoute().

import { createSiteIdentityStore, createAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";

const SITE_ID = "default";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const from = clampInt(url.searchParams.get("from"), 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const identityStore = await createSiteIdentityStore(env);
  const identity = await identityStore.get(SITE_ID);
  if (!identity) return json({ error: "site_identity_not_found" }, 404);

  const log = await createAttestationLogStore(env);
  const head = await log.head(SITE_ID);
  const page = await log.list(SITE_ID, from, limit + 1);
  const entries = page.slice(0, limit).map((e) => ({ seq: e.seq, att: e.attHash, jws: e.attJws ?? null }));
  const next = page.length > limit ? page[limit].seq : null;

  return json(
    { did: identity.did, length: head ? head.seq : 0, entries, next },
    200,
    { "cache-control": "public, max-age=60" }
  );
}
