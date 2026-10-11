// functions/admin/api/index/sync.js
//
// POST /admin/api/index/sync (Portaless Index, APW v1.3 5.7 y seccion 7).
// Sincroniza UN sujeto contra el set de testigos indicado: por cada testigo
// baja su cadena verificada y su /.well-known/apw-witnesses.json, verifica
// cada statement de punta a punta (anclaje en la cadena del testigo +
// firma + jti determinista), guarda las observaciones ancladas, evalua
// contra la cadena ACTUAL del sujeto (head_mismatch / equivocation /
// backdated_entry) y cachea la entrada de directorio que publica
// /.well-known/apw-index.json.
//
// Body: {
//   domain:   "<dominio del sujeto>",
//   witnesses: ["<dominio del testigo>", ...]   (1..20)
//   weights?:  { "did:apw:<testigo>": 0.5, ... } (opcional; se persiste)
// }
//
// Seguridad: sesion + rol admin (mismo patron que /admin/api/witness/record).
// Sin step-up: todo lo que baja y verifica es publico (TXT + .well-known de
// terceros); el endpoint solo decide QUE testigos escucha este nodo.
// Fail-closed: un testigo inaccesible o con cadena rota se saltea y viaja
// en witnessesSkipped; jamas guarda observaciones que no verifiquen.

import { createWitnessIndexStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { resolveApwHistory } from "../../../../packages/apw-resolver/src/did-apw/history-resolver.ts";
import { syncWitnessIndex } from "../../../../packages/apw-resolver/src/did-apw/witness-index.ts";

const SITE_ID = "default";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_WITNESSES = 20;
const FETCH_TIMEOUT_MS = 10000;
const MAX_TEXT_BYTES = 2_000_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function normalizeDomain(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[.]$/, "") : "";
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_TEXT_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

function resolveHistory(domain) {
  return resolveApwHistory(domain, fetch, { includeEntries: true, includeKeys: true });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const user = context.data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const domain = normalizeDomain(body?.domain);
  if (!DOMAIN_RE.test(domain)) {
    return json({ error: "invalid_domain", message: "domain debe ser un hostname valido, sin esquema ni ruta." }, 400);
  }

  const rawWitnesses = Array.isArray(body?.witnesses) ? body.witnesses : null;
  if (!rawWitnesses || rawWitnesses.length === 0 || rawWitnesses.length > MAX_WITNESSES) {
    return json({ error: "invalid_witnesses", message: `witnesses debe ser un array de 1..${MAX_WITNESSES} dominios de testigos.` }, 400);
  }
  const witnesses = [...new Set(rawWitnesses.map(normalizeDomain))];
  for (const w of witnesses) {
    if (!DOMAIN_RE.test(w)) {
      return json({ error: "invalid_witnesses", message: `'${w}' no es un hostname valido de testigo.` }, 400);
    }
  }

  let weights;
  if (body?.weights !== undefined) {
    if (!body.weights || typeof body.weights !== "object" || Array.isArray(body.weights)) {
      return json({ error: "invalid_weights", message: "weights debe ser un objeto { 'did:apw:<testigo>': numero }." }, 400);
    }
    if (Object.keys(body.weights).length > MAX_WITNESSES * 2) {
      return json({ error: "invalid_weights", message: "Demasiados pesos en una sola llamada." }, 400);
    }
    weights = body.weights;
  }

  try {
    const store = await createWitnessIndexStore(env);
    const entry = await syncWitnessIndex({ fetchText, resolveHistory }, store, { siteId: SITE_ID, domain, witnesses, weights });
    return json({ synced: entry }, 200);
  } catch (err) {
    const code = String(err && err.message);
    if (code === "invalid_witness_weight" || code === "invalid_witness_did" || code === "invalid_domain") {
      return json({ error: code }, 400);
    }
    throw err;
  }
}
