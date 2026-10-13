// functions/admin/api/index/peers.js
//
// GET  /admin/api/index/peers -- lista los pares nodo-indice configurados
//      (con su ultimo estado de sincronizacion).
// POST /admin/api/index/peers -- agrega o quita un par.
// Body: { domain: "<hostname>", action?: "add" | "remove" }  (add por defecto)
//
// Portaless Index, sincronizacion entre nodos (Phase 5): los pares son
// otros despliegues de Portaless cuyo /.well-known/apw-index.json este
// nodo baja en POST /admin/api/index/sync-peers, usandolo como
// DESCUBRIMIENTO de sujetos/testigos y re-verificando todo localmente.
//
// Seguridad: sesion + rol admin (mismo patron que /admin/api/index/sync).
// Sin step-up: solo se guarda una lista de hostnames publicos; nada
// sensible viaja ni se verifica en este endpoint.

import { createWitnessIndexStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { createSiteIdentityStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";

const SITE_ID = "default";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_PEERS = 20;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function normalizeDomain(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[.]$/, "") : "";
}

function requireAdmin(context) {
  const user = context.data?.user;
  if (!user) return null;
  if (user.role !== "admin") return "forbidden";
  return user;
}

export async function onRequestGet(context) {
  const user = requireAdmin(context);
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user === "forbidden") {
    return json({ error: "forbidden", message: "El rol no tiene permiso de lectura. Se requiere rol 'admin'." }, 403);
  }
  const store = await createWitnessIndexStore(context.env);
  const peers = await store.listPeers(SITE_ID);
  return json({ peers });
}

export async function onRequestPost(context) {
  const user = requireAdmin(context);
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user === "forbidden") {
    return json({ error: "forbidden", message: "El rol no tiene permiso de escritura. Se requiere rol 'admin'." }, 403);
  }

  let body;
  try {
    body = await requestJson(context);
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const domain = normalizeDomain(body?.domain);
  if (!DOMAIN_RE.test(domain)) {
    return json({ error: "invalid_domain", message: "domain debe ser un hostname valido, sin esquema ni ruta." }, 400);
  }

  const action = body?.action ?? "add";
  if (action !== "add" && action !== "remove") {
    return json({ error: "invalid_action", message: 'action debe ser "add" o "remove".' }, 400);
  }

  // El nodo no puede ser par de si mismo: el sync de pares se saltaria
  // igual (self_peer), pero rechazarlo aca da feedback inmediato.
  const identityStore = await createSiteIdentityStore(context.env);
  const identity = await identityStore.get(SITE_ID);
  if (identity?.did === `did:apw:${domain}`) {
    return json({ error: "self_peer", message: "Este nodo ya es el dueño de ese dominio; no puede ser su propio par." }, 400);
  }

  const store = await createWitnessIndexStore(context.env);

  if (action === "remove") {
    const removed = await store.removePeer(SITE_ID, domain);
    return json({ removed, peerDomain: domain }, removed ? 200 : 404);
  }

  const peers = await store.listPeers(SITE_ID);
  if (!peers.some((p) => p.peerDomain === domain) && peers.length >= MAX_PEERS) {
    return json({ error: "too_many_peers", message: `Maximo ${MAX_PEERS} pares por nodo.` }, 400);
  }

  await store.addPeer({ siteId: SITE_ID, peerDomain: domain, peerDid: null, addedAt: new Date().toISOString() });
  const updated = await store.listPeers(SITE_ID);
  const peer = updated.find((p) => p.peerDomain === domain);
  return json({ added: true, peer }, 201);
}

async function requestJson(context) {
  return context.request.json();
}
