// functions/admin/api/index/sync-peers.js
//
// POST /admin/api/index/sync-peers -- baja el /.well-known/apw-index.json
// de cada par configurado (o de los indicados en el body) y usa sus
// entradas como descubrimiento: por cada (sujeto, testigos) del par corre
// el MISMO pipeline fail-closed de /admin/api/index/sync (cadena del
// testigo -> statements anclados -> firma -> jti), re-verificando todo
// localmente. Un par malicioso solo puede lograr que este nodo verifique
// cadenas reales; nunca inyecta observaciones sin verificar.
//
// Body (opcional): { peers?: ["<hostname>", ...] }  (default: todos)
//
// Seguridad: sesion + rol admin (mismo patron que /admin/api/index/sync).
// Sin step-up: todo lo que baja y verifica es publico (apw-index.json de
// pares + TXT/.well-known de terceros); el endpoint solo decide QUE nodos
// escucha este nodo.

import { createWitnessIndexStore, createSiteIdentityStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { resolveApwHistory } from "../../../../packages/apw-resolver/src/did-apw/history-resolver.ts";
import { createBoundedPublicFetch } from "../../../_shared/public-egress.js";
import { syncIndexPeers } from "../../../../packages/apw-resolver/src/did-apw/witness-index.ts";

const SITE_ID = "default";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_PEERS = 20;
const FETCH_TIMEOUT_MS = 10000;
const MAX_TEXT_BYTES = 2_000_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function normalizeDomain(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[.]$/, "") : "";
}

async function fetchText(url, fetchImpl) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_TEXT_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

function resolveHistory(domain, fetchImpl) {
  return resolveApwHistory(domain, fetchImpl, { includeEntries: true, includeKeys: true, maxPages: 10 });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const user = context.data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body = {};
  const hasBody = request.headers.get("content-type")?.includes("application/json");
  if (hasBody) {
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json_body" }, 400);
    }
  }

  let peers;
  if (body?.peers !== undefined) {
    if (!Array.isArray(body.peers) || body.peers.length === 0 || body.peers.length > MAX_PEERS) {
      return json({ error: "invalid_peers", message: `peers debe ser un array de 1..${MAX_PEERS} hostnames.` }, 400);
    }
    peers = [...new Set(body.peers.map(normalizeDomain))];
    for (const p of peers) {
      if (!DOMAIN_RE.test(p)) {
        return json({ error: "invalid_peers", message: `'${p}' no es un hostname valido de par.` }, 400);
      }
    }
  }

  const store = await createWitnessIndexStore(env);
  const identityStore = await createSiteIdentityStore(env);
  const identity = await identityStore.get(SITE_ID);
  const ownDomain = identity?.did?.startsWith("did:apw:") ? identity.did.slice("did:apw:".length) : undefined;

  const fetchImpl = createBoundedPublicFetch(env, { maxRequests: 200, deadlineMs: 30000, maxBytes: 2_000_000 });
  const result = await syncIndexPeers({
    fetchText: (url) => fetchText(url, fetchImpl),
    resolveHistory: (domain) => resolveHistory(domain, fetchImpl),
  }, store, { siteId: SITE_ID, peers, ownDomain });
  return json(result);
}
