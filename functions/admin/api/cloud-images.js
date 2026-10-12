// Endpoint admin de Cloud Images: sube un PNG, lo firma con la clave
// activa del sitio (sidecar JWS Ed25519, typ apw-image+jws) y lo registra
// en cloud_images (docs/architecture/cloud-images.md).
//
// POST   /admin/api/cloud-images -> { imageBase64, declaredOrigin } y
//        responde { image, deduplicated }. La firma es AUTOMATICA: el
//        servidor nunca confia en un sidecar subido por el cliente.
// GET    /admin/api/cloud-images -> { images } (sin bytes).
// DELETE /admin/api/cloud-images -> { imageId } -> { removed }.
//
// Reglas honestas de v1 (ROADMAP: alcance "Cloud Images + APW como SSOT"):
//   - solo image/png: el embedding pAPW existe para PNG; jpeg/webp/gif
//     quedan para cuando exista su transporte de sidecar;
//   - teto de 4 MiB (MAX_IMAGE_BYTES); R2 es item externo;
//   - dedupe por sha256(content): repetir la MISMA imagen devuelve la
//     registrada (deduplicated: true) en vez de fallar por el indice unico;
//   - declaredOrigin es OBLIGATORIO: el sitio declara human|ai|mixed y
//     esa declaracion va dentro de lo firmado (la moderacion de
//     declaraciones falsas es trabajo futuro);
//   - sin identidad did:apw activa no se puede firmar -> 404
//     site_identity_not_found (mismo codigo que witness/record.js).
//
// Seguridad: sesion (context.data.user) + canWrite(role) server-side,
// igual que apw-atproto-links.js.

import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { createCloudImageStore } from "../../../packages/cloud-images/src/store.ts";
import { captureSiteTrust, IMAGE_SITE_ID } from "../../../packages/cloud-images/src/trust.ts";
import {
  buildCloudImagePayload,
  decodeBase64,
  sha256Hash,
  isDeclaredOrigin,
  MAX_IMAGE_BYTES,
} from "../../../packages/cloud-images/src/payload.ts";
import { signCloudImage } from "../../../packages/cloud-images/src/sign.ts";
import { embedPng, isPng } from "../../../packages/cloud-images/src/png.ts";

const SITE_ID = IMAGE_SITE_ID;
const CONTENT_TYPE = "image/png";

function canWrite(role) {
  return role === "admin";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function newImageId() {
  return `img-${crypto.randomUUID()}`;
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return json({ error: "unauthenticated" }, 401);

  const store = await createCloudImageStore(env);
  const images = await store.list();
  return json({ images });
}

export async function onRequestPost(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!canWrite(user.role)) {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body", message: "El cuerpo debe ser JSON valido." }, 400);
  }

  if (!isDeclaredOrigin(body?.declaredOrigin)) {
    return json(
      { error: "invalid_declared_origin", message: "declaredOrigin es obligatorio: human | ai | mixed. El sitio declara el origen y esa declaracion va firmada." },
      400
    );
  }

  const bytes = decodeBase64(body?.imageBase64);
  if (!bytes || bytes.length === 0) {
    return json({ error: "invalid_image", message: "imageBase64 debe ser base64 valido de una imagen." }, 400);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return json({ error: "image_too_large", message: `La imagen supera el teto de ${MAX_IMAGE_BYTES} bytes (4 MiB).` }, 400);
  }
  if (!isPng(bytes)) {
    return json(
      { error: "unsupported_content_type", message: "v1 acepta solo image/png: el sidecar se embebe en un chunk pAPW del propio PNG." },
      400
    );
  }

  const store = await createCloudImageStore(env);
  const contentHash = await sha256Hash(bytes);

  const existing = await store.getByContentHash(contentHash);
  if (existing) {
    return json({ ok: true, deduplicated: true, image: existing }, 200);
  }

  const identityStore = await createSiteIdentityStore(env);
  const identity = await identityStore.get(SITE_ID);
  const key = identity ? await identityStore.getActiveSigningKey(SITE_ID) : null;
  if (!identity || !key) {
    return json(
      { error: "site_identity_not_found", message: "El sitio necesita una identidad did:apw activa para firmar cloud images." },
      404
    );
  }

  const payload = buildCloudImagePayload({
    imageId: newImageId(),
    contentHash,
    contentType: CONTENT_TYPE,
    byteLength: bytes.length,
    declaredOrigin: body.declaredOrigin,
    siteId: SITE_ID,
    siteDid: identity.did,
    signedAt: new Date().toISOString(),
    trust: await captureSiteTrust(env),
  });
  const jws = await signCloudImage(payload, { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk });
  const sidecar = { payload, jws };

  const record = await store.put({
    sidecar,
    bytes: embedPng(bytes, JSON.stringify(sidecar)),
    keyId: key.keyId,
    createdBy: user.username ?? user.email ?? null,
  });

  return json({ ok: true, deduplicated: false, image: record }, 201);
}

export async function onRequestDelete(context) {
  const { request, data, env } = context;

  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!canWrite(user.role)) {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body", message: "El cuerpo debe ser JSON valido." }, 400);
  }

  const imageId = typeof body?.imageId === "string" ? body.imageId : "";
  if (!imageId) {
    return json({ error: "invalid_image_id", message: "imageId es obligatorio." }, 400);
  }

  const store = await createCloudImageStore(env);
  const removed = await store.remove(imageId);
  return json({ ok: true, removed });
}
