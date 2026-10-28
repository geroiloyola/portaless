// POST /trust/images/verify -- verificacion STANDALONE de un sidecar
// contra el registro APW: "C2PA sin autoridad central" (ROADMAP Cloud
// Images). Cualquiera con el sidecar (y opcionalmente la imagen) lo
// verifica sin pedirle permiso a nadie:
//
//   1. kid del header debe pertenecer al siteDid del payload;
//   2. claves del historial encadenado del sitio (sobreviven rotaciones),
//      fallback a did.json si el sitio no tiene historial aun;
//   3. firma Ed25519 + payload canonico JCS;
//   4. con imageBase64: sha256 de la imagen (original o con pAPW ya
//      embebido) vs contentHash firmado.
//
// Body: { sidecar: { payload, jws }, imageBase64?: string }
// 200 siempre con el resultado estructurado ({ valid, reason?,
// signature, contentHash, keySource, payload? }): la verificacion NUNCA
// lanza, los fallos vuelven como datos (mismo principio que
// resolveApwIdentity). 400 solo si el body no es JSON o falta el sidecar.
//
// Publico: CORS *, no-store (depende del body).

import { parseSidecar } from "../../../packages/cloud-images/src/payload.ts";
import { verifySidecarRemote } from "../../../packages/cloud-images/src/verify-remote.ts";
import { resolveApwHistory } from "../../../packages/apw-resolver/src/did-apw/history-resolver.ts";
import { resolveApwIdentity } from "../../../packages/apw-resolver/src/index.ts";
import { readJsonBodyLimited } from "../../_shared/public-body.js";
import { allowPublicEgress, createBoundedPublicFetch } from "../../_shared/public-egress.js";

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await allowPublicEgress(env, request, {
    action: "trust:images-verify:ip",
    ipLimit: 20,
    actorLimit: 20,
  }))) {
    return json({ error: "rate_limited", message: "Demasiadas solicitudes. Reintenta mas tarde." }, 429, CORS);
  }

  const bodyResult = await readJsonBodyLimited(request, 8 * 1024 * 1024);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error, message: "El cuerpo debe ser JSON valido dentro del limite permitido." }, bodyResult.status, CORS);
  }
  const body = bodyResult.value;

  const sidecar = parseSidecar(body?.sidecar);
  if (!sidecar) {
    return json(
      { error: "invalid_sidecar", message: "sidecar debe ser { payload, jws } valido (formato Cloud Image v1)." },
      400,
      CORS
    );
  }

  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : undefined;
  const fetchImpl = createBoundedPublicFetch(env, { maxRequests: 10, deadlineMs: 6000 });
  const result = await verifySidecarRemote(sidecar, {
    imageBase64,
    fetchImpl,
    resolveHistory: (domain, options) => resolveApwHistory(domain, fetchImpl, options),
    resolveDid: (domain, fetch) => resolveApwIdentity(domain, fetch),
  });
  return json(result, 200, CORS);
}
