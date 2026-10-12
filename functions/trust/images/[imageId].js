// GET /trust/images/:imageId -- verificacion PUBLICA local de una cloud
// image registrada (docs/architecture/cloud-images.md).
//
// Devuelve la metadata (incluido el sidecar firmado) + el resultado de
// verificarla contra el registro LOCAL:
//   - signature: firma Ed25519 contra las claves de site_identity
//     (listKeys: incluye claves retiradas, asi sobrevive rotaciones);
//   - embedded: el chunk pAPW extraido de los bytes coincide con el
//     sidecar del registro (match | mismatch | missing);
//   - contentHash: sha256(stripPng(bytes)) vs contentHash registrado.
//
// Para verificar una imagen que viene de OTRO lado (sidecar suelto,
// viaja en un .json aparte) esta POST /trust/images/verify, que resuelve
// el registro APW remoto -- aca no hay resolucion remota: es el sitio
// hablando de su propio registro.
//
// Publico igual que GET /trust/:siteId: CORS *, cache corto.

import { createCloudImageStore } from "../../../packages/cloud-images/src/store.ts";
import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { sha256Hash } from "../../../packages/cloud-images/src/payload.ts";
import { verifyCloudImageSidecar } from "../../../packages/cloud-images/src/sign.ts";
import { isPng, extractPng, stripPng } from "../../../packages/cloud-images/src/png.ts";
import { IMAGE_SITE_ID } from "../../../packages/cloud-images/src/trust.ts";

const SITE_ID = IMAGE_SITE_ID;

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export async function onRequestGet(context) {
  const { params, env } = context;

  const imageId = typeof params?.imageId === "string" ? params.imageId : "";
  if (!imageId) return json({ error: "invalid_image_id" }, 400);

  const store = await createCloudImageStore(env);
  const entry = await store.get(imageId);
  if (!entry) {
    return json({ error: "image_not_found" }, 404, { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" });
  }

  const { record, bytes } = entry;

  const embeddedJson = isPng(bytes) ? extractPng(bytes) : null;
  const embedded = embeddedJson === null
    ? { status: "missing" }
    : embeddedJson === JSON.stringify(record.sidecar)
      ? { status: "match" }
      : { status: "mismatch" };

  const identityStore = await createSiteIdentityStore(env);
  const keys = (await identityStore.listKeys(SITE_ID)).map((key) => ({
    keyId: key.keyId,
    kid: key.kid,
    publicKeyJwk: key.publicKeyJwk,
  }));
  const signature = await verifyCloudImageSidecar(record.sidecar, keys);

  let contentHash = { status: "not_checked" };
  try {
    contentHash = { status: (await sha256Hash(stripPng(bytes))) === record.contentHash ? "match" : "mismatch" };
  } catch {
    contentHash = { status: "not_checked" };
  }

  const valid = signature.ok && embedded.status === "match" && contentHash.status === "match";

  return json(
    {
      image: {
        imageId: record.imageId,
        contentHash: record.contentHash,
        contentType: record.contentType,
        byteLength: record.byteLength,
        declaredOrigin: record.declaredOrigin,
        siteId: record.siteId,
        siteDid: record.siteDid,
        keyId: record.keyId,
        keyAlgorithm: record.keyAlgorithm,
        signedAt: record.signedAt,
        trust: record.sidecar.payload.trust,
        sidecar: record.sidecar,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
      },
      verification: {
        valid,
        signature: signature.ok ? { valid: true } : { valid: false, reason: signature.reason },
        embedded,
        contentHash,
        keySource: "local_store",
      },
    },
    200,
    { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" }
  );
}
