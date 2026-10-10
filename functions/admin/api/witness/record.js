// functions/admin/api/witness/record.js
//
// POST /admin/api/witness/record (ERRATA E-10, APW v1.3 seccion 5.7).
// ESTE sitio actua como testigo de otro: resuelve la cadena encadenada del
// sujeto via resolveApwHistory() (DNS + /.well-known/apw-log.json, sin
// confiar en nada local del sujeto) y anota en SU PROPIO historial un
// statement firmado con la cabeza observada:
//
//   { typ: "apw-witness+jws", iss: did del testigo, sub, seq, head, ts, jti }
//
// Anotarlo en el historial proprio es lo que le da fecha creible al
// statement: la entrada queda encadenada y su ts se ancla con el `h` del
// testigo en el DNS. Se publica en /.well-known/apw-witnesses.json (y ya
// aparece en apw-attestations.json, que publica todo att_jws).
//
// Body: { domain: "<dominio observado>" }
//
// Seguridad: sesion + rol admin (mismo patron que el resto de /admin).
// No requiere step-up: el statement solo afirma lo que el testigo VIO de
// una cadena publica; una sesion robada no puede inventar atestaciones de
// terceros ni tocar la reputacion de nadie. El jti es determinista
// (wt-<hash(iss|sub|seq|head)>): repetir la observacion del mismo head
// choca con el indice unico (site_id, att_hash) y responde already_recorded.

import { createSiteIdentityStore, createAttestationLogStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { appendAttestation } from "../../../../packages/apw-resolver/src/did-apw/history-log.ts";
import { signWitnessStatement } from "../../../../packages/apw-resolver/src/did-apw/witness.ts";
import { resolveApwHistory } from "../../../../packages/apw-resolver/src/did-apw/history-resolver.ts";

const SITE_ID = "default";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
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
  const domain = typeof body?.domain === "string" ? body.domain.trim().toLowerCase().replace(/[.]$/, "") : "";
  if (!DOMAIN_RE.test(domain)) {
    return json({ error: "invalid_domain", message: "domain debe ser un hostname valido, sin esquema ni ruta." }, 400);
  }

  const identityStore = await createSiteIdentityStore(env);
  const identity = await identityStore.get(SITE_ID);
  const key = identity ? await identityStore.getActiveSigningKey(SITE_ID) : null;
  if (!identity || !key) {
    return json({ error: "site_identity_not_found", message: "El sitio necesita una identidad did:apw para firmar statements de testigo." }, 404);
  }

  const subjectDid = `did:apw:${domain}`;
  if (subjectDid === identity.did) {
    return json({ error: "self_witness", message: "Un sitio no puede ser testigo de si mismo." }, 400);
  }

  const history = await resolveApwHistory(domain);
  if (!history.verified) {
    return json({ error: "subject_history_unverified", reason: history.reason, message: "La cadena del sujeto no verifico contra su TXT y su apw-log.json." }, 422);
  }

  const now = new Date();
  const { jws, payload } = await signWitnessStatement(
    { iss: identity.did, sub: subjectDid, seq: history.length ?? 0, head: history.head ?? null, ts: now.toISOString() },
    { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
  );

  let entry;
  try {
    entry = await appendAttestation({ identity: identityStore, log: await createAttestationLogStore(env), siteId: SITE_ID }, jws);
  } catch (err) {
    if (String(err && err.message) === "duplicate_attestation") {
      return json({ recorded: false, reason: "already_recorded", subject: subjectDid, subjectSeq: payload.seq, subjectHead: payload.head }, 200);
    }
    throw err;
  }

  return json(
    {
      recorded: true,
      subject: subjectDid,
      subjectSeq: payload.seq,
      subjectHead: payload.head,
      subjectAnchoredSeq: history.anchoredSeq ?? null,
      ownSeq: entry.seq,
      ownHead: entry.entryHash,
      statementJti: payload.jti,
    },
    201
  );
}
