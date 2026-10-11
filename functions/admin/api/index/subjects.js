// functions/admin/api/index/subjects.js
//
// GET /admin/api/index/subjects (Portaless Index, APW 5.7 y seccion 7).
// Lista el directorio cacheado de este nodo: la ultima entrada computada
// por subject por POST /admin/api/index/sync, mas los pesos vigentes de los
// testigos. `?subject=did:apw:<dominio>` filtra a un sujeto (404 si no
// esta en el directorio).
//
// Seguridad: sesion + rol admin. La publicacion para terceros es el
// documento plano de /.well-known/apw-index.json.

import { createWitnessIndexStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { parseSubjectEntry } from "../../../../packages/apw-resolver/src/did-apw/witness-index.ts";

const SITE_ID = "default";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = context.data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de lectura de este recurso. Se requiere rol 'admin'.` }, 403);
  }

  const store = await createWitnessIndexStore(env);
  const subjectFilter = new URL(request.url).searchParams.get("subject");

  if (subjectFilter) {
    const rec = await store.getSubjectEntry(SITE_ID, subjectFilter.trim());
    const entry = rec ? parseSubjectEntry(rec.entryJson) : null;
    if (!entry) return json({ error: "subject_not_indexed", subject: subjectFilter }, 404);
    return json({ subject: entry, weights: await store.getWeights(SITE_ID) });
  }

  const rows = await store.listSubjectEntries(SITE_ID);
  const subjects = [];
  for (const row of rows) {
    const entry = parseSubjectEntry(row.entryJson);
    if (entry) subjects.push(entry);
  }
  return json({ subjects, weights: await store.getWeights(SITE_ID) });
}
