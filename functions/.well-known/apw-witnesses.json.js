// GET /.well-known/apw-witnesses.json -- statements de testigo emitidos por
// ESTE sitio (ERRATA E-10, APW v1.3 seccion 5.7).
//
// El historial encadenado guarda todo att_jws en apw-attestations.json.
// Este endpoint publica SOLO los statements typ "apw-witness+jws": lo que
// este sitio observo de las cadenas de otros dominios, con la cabeza
// (seq, head) que vio y el ts de la entrada del historial donde se anoto
// (su fecha creible, anclada por el `h` del testigo en el DNS).
//
//   { seq, att, jws, witness: { sub, seq, head, ts } }
//
// Como se verifica un evaluator (packages/apw-resolver/src/did-apw/witness.ts):
//   1. cadena DEL TESTIGO verificada (resolveApwHistory(testigo));
//   2. att === base64url(SHA-256(jws)) en esa cadena;
//   3. firma del statement contra la clave del testigo (verifyWitnessStatement);
//   4. evaluateWitnesses(statements, cadena actual del sujeto).
//
// Paginado igual que apw-attestations.json (?from, ?limit): pagina el
// historial completo hasta reunir `limit` statements de testigo. Ruta
// publica: /.well-known/* pasa por isPublicBotRoute().

import { createSiteIdentityStore, createAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { WITNESS_TYP } from "../../packages/apw-resolver/src/did-apw/witness.ts";

const SITE_ID = "default";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const LOG_PAGE = 500;
const MAX_SCAN_PAGES = 40;

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

function decodePayload(jws) {
  try {
    const part = jws.split(".")[1];
    const base64 = part.split("-").join("+").split("_").join("/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
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

  const entries = [];
  let next = null;
  let cursor = from;
  for (let page = 0; page < MAX_SCAN_PAGES && entries.length <= limit; page++) {
    const rows = await log.list(SITE_ID, cursor, LOG_PAGE);
    if (rows.length === 0) break;
    for (const row of rows) {
      const payload = row.attJws ? decodePayload(row.attJws) : null;
      if (!payload || payload.typ !== WITNESS_TYP) continue;
      if (entries.length === limit) {
        next = row.seq;
        break;
      }
      entries.push({
        seq: row.seq,
        att: row.attHash,
        jws: row.attJws,
        witness: { sub: payload.sub ?? null, seq: payload.seq ?? null, head: payload.head ?? null, ts: payload.ts ?? null, jti: payload.jti ?? null },
      });
    }
    if (next !== null || rows.length < LOG_PAGE) break;
    cursor = rows[rows.length - 1].seq + 1;
  }

  return json(
    { did: identity.did, length: head ? head.seq : 0, entries, next },
    200,
    { "cache-control": "public, max-age=60" }
  );
}
