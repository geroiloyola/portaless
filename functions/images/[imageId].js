// GET /images/:imageId -- serve PUBLICO de una cloud image registrada.
//
// Devuelve los bytes tal cual quedaron en el registro (con el sidecar ya
// embebido en el chunk pAPW del PNG, asi la imagen es autosuficiente: si
// viaja sola, lleva su propia metadata firmada). ETag = contentHash y
// cache immutable: el contenido de una imagen registrada NUNCA cambia
// (nueva version = nuevo imageId, y el sha256 unico lo garantiza).
//
// Publico igual que /trust/:siteId. 404 si el imageId no existe.

import { createCloudImageStore } from "../../packages/cloud-images/src/store.ts";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export async function onRequestGet(context) {
  const { params, request, env } = context;

  const imageId = typeof params?.imageId === "string" ? params.imageId : "";
  if (!imageId) return json({ error: "invalid_image_id" }, 400);

  const store = await createCloudImageStore(env);
  const entry = await store.get(imageId);
  if (!entry) return json({ error: "image_not_found" }, 404);

  const etag = `"${entry.record.contentHash}"`;
  const headers = {
    "content-type": entry.record.contentType,
    etag,
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  headers["content-length"] = String(entry.bytes.length);
  return new Response(entry.bytes, { status: 200, headers });
}
