// GET /.well-known/apw-index.json -- directorio de testigos de este nodo
// (Portaless Index, APW v1.3 5.7 y seccion 7).
//
// Publica la ultima entrada cacheada por sujeto, computada por
// POST /admin/api/index/sync: status (consistent / head_mismatch /
// equivocation / backdated_entry / subject_chain_unverified /
// no_observations), observaciones ancladas de cada testigo con su peso,
// hallazgos de evaluateWitnesses y el consenso ponderado de la ultima seq
// observada. El documento es JSON plano y SIN firma: el `iss` es el did:apw
// de este nodo y cada entrada es re-verificable contra las cadenas del
// sujeto y de sus testigos (el indice no es una fuente de verdad, es un
// cache de observaciones ya verificadas al syncear).
//
// El directorio refleja la ULTIMA sincronizacion de cada sujeto, no la
// cadena viva en este instante; el `syncedAt` de cada entrada lo dice.
//
// Ruta publica: /.well-known/* pasa por isPublicBotRoute().

import { createSiteIdentityStore, createWitnessIndexStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { buildIndexDocument, parseSubjectEntry } from "../../packages/apw-resolver/src/did-apw/witness-index.ts";

const SITE_ID = "default";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extra },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  const identityStore = await createSiteIdentityStore(env);
  const identity = await identityStore.get(SITE_ID);
  if (!identity) return json({ error: "site_identity_not_found" }, 404);

  const store = await createWitnessIndexStore(env);
  const rows = await store.listSubjectEntries(SITE_ID);
  const subjects = [];
  for (const row of rows) {
    const entry = parseSubjectEntry(row.entryJson);
    if (entry) subjects.push(entry);
  }

  return json(
    buildIndexDocument(subjects, { indexDid: identity.did, generatedAt: new Date().toISOString() }),
    200,
    { "cache-control": "public, max-age=60" }
  );
}
