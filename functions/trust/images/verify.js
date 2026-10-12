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

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body", message: "El cuerpo debe ser JSON valido." }, 400, CORS);
  }

  const sidecar = parseSidecar(body?.sidecar);
  if (!sidecar) {
    return json(
      { error: "invalid_sidecar", message: "sidecar debe ser { payload, jws } valido (formato Cloud Image v1)." },
      400,
      CORS
    );
  }

  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : undefined;
  const result = await verifySidecarRemote(sidecar, { imageBase64 });
  return json(result, 200, CORS);
}
