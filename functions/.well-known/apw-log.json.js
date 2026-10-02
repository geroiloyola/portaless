// GET /.well-known/apw-log.json -- historial encadenado del sitio, lectura
// publica (APW v1.2, seccion 5.4, cierra B6).
//
// Devuelve las entradas del log (JWS compactos firmados por el sitio) y TODAS
// las claves publicas que el sitio uso, con su ventana de validez, para que un
// verificador externo pueda comprobar entradas viejas despues de una rotacion
// sin acceso a la base de datos. Las claves se sirven solo con sus miembros
// publicos (crv, kty, x): nunca la privada.
//
// Paginado: ?from=<seq> (default 1) y ?limit=<n> (default 100, max 500).
// `next` es la seq desde la que pedir la pagina siguiente, o null.
// `head` es la ultima entrada: su hash es el `h` que va en el TXT.
//
// Como se verifica: resolveApwHistory() en
// packages/apw-resolver/src/did-apw/history-resolver.ts.
//
// Ruta publica: /.well-known/* ya pasa sin firma por isPublicBotRoute().

import { createSiteIdentityStore, createAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { publicJwkMembers } from "../../packages/apw-resolver/src/did-apw/fingerprint.ts";

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

  const keys = [];
  for (const key of await identityStore.listKeys(SITE_ID)) {
    try {
      keys.push({
        kid: key.kid,
        publicKeyJwk: publicJwkMembers(key.publicKeyJwk),
        validFrom: key.validFrom,
        validTo: key.validTo,
      });
    } catch {
      // una clave con forma invalida no se publica
    }
  }

  const log = await createAttestationLogStore(env);
  const head = await log.head(SITE_ID);
  const page = await log.list(SITE_ID, from, limit + 1);
  const entries = page.slice(0, limit).map((e) => ({ seq: e.seq, jws: e.entryJws }));
  const next = page.length > limit ? page[limit].seq : null;

  return json(
    {
      did: identity.did,
      head: head ? { seq: head.seq, hash: head.entryHash } : null,
      length: head ? head.seq : 0,
      keys,
      entries,
      next,
    },
    200,
    { "cache-control": "public, max-age=60" }
  );
}
