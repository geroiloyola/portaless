// GET /trust/atproto/:handle -- join PUBLICO de identidad AT Protocol +
// reputacion APW (puente opcional, docs/architecture/identity-atproto.md).
//
// Devuelve para un handle AT (@username.wikipedia.org, con o sin "@"):
//   - identidad resuelta segun el spec AT (handle <-> DID bidireccional,
//     clave de firma, PDS);
//   - el vinculo APW mas cercano (self / subdomain / also_known_as) con
//     la reputacion W publica del sitio (local o del endpoint /trust del
//     sitio remoto);
//   - la reputacion R del usuario si existe historial reader_conduct
//     para did:apw:<handle>; si no, status "no_data" honesto.
//
// Mismo tratamiento que GET /trust/:siteId: publico, CORS *, cache corto.
// 400 handle invalido/reservado; 404 no resuelve o link invalido; 502 el
// upstream de resolucion esta caido. Nunca lanza: los fallos de join
// (trust remoto ilegible, sin conduct) degradan dentro de la respuesta.
//
// Limite documentado: la resolucion sale de esta funcion hacia terceros
// (DNS, plc.directory, el propio handle) -- ver identity-atproto.md.

import { buildAtprotoReputation } from "../../../packages/identity-atproto/src/reputation.ts";
import { allowPublicEgress, createBoundedPublicFetch } from "../../_shared/public-egress.js";

const STATUS_BY_REASON = {
  invalid_handle: 400,
  reserved_tld: 400,
  handle_unresolvable: 404,
  ambiguous_txt: 404,
  unsupported_did_method: 404,
  link_mismatch: 404,
  did_not_found: 404,
  upstream_error: 502,
  did_unreachable: 502,
  malformed_document: 502,
  did_mismatch: 502,
  response_too_large: 502,
  did_syntax_invalid: 502,
  did_method_unsupported: 502,
  did_web_unsupported: 502,
};

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export async function onRequestGet(context) {
  const { params, env, request } = context;

  if (!(await allowPublicEgress(env, request, {
    action: "trust:atproto:ip",
    ipLimit: 30,
    actorLimit: 30,
  }))) {
    return json({ error: "rate_limited", message: "Demasiadas solicitudes. Reintenta mas tarde." }, 429, {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
  }

  const fetchImpl = createBoundedPublicFetch(env, { maxRequests: 12, deadlineMs: 8000 });
  const result = await buildAtprotoReputation(params?.handle, { env, fetchImpl });

  if (!result.resolved) {
    const status = STATUS_BY_REASON[result.reason] ?? 404;
    return json({ error: result.reason ?? "unresolvable", handle: result.handle }, status, {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    });
  }

  return json(result, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
}
