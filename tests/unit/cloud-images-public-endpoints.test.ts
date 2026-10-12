// Endpoints publicos de Cloud Images: serve de bytes (/images/:id) y
// verificacion local (/trust/images/:id). Setup end-to-end real (sqlite
// temporal + identidad + upload via el endpoint admin), y despues:
//   - serve: 404, headers de cache immutable con ETag = contentHash,
//     304 con If-None-Match, bytes con el sidecar embebido;
//   - trust local: verificacion valida contra listKeys (claves del sitio),
//     sobrevive ROTACION de clave (la vieja queda en listKeys), 404.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { applySchema } from "../../scripts/setup.mjs";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { createSiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/store-factory";
import { crc32, PNG_SIGNATURE } from "../../packages/cloud-images/src/png";
import { encodeBase64 } from "../../packages/cloud-images/src/payload";
import * as adminImages from "../../functions/admin/api/cloud-images";
import * as serveImages from "../../functions/images/[imageId]";
import * as trustImages from "../../functions/trust/images/[imageId]";

const SITE_ID = "default";
const tmp = mkdtempSync(join(tmpdir(), "portaless-cloud-images-public-"));
const DB = join(tmp, "portaless.db");

let env: Record<string, unknown>;
let imageId: string;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const PNG = (() => {
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])),
    chunk("IDAT", Uint8Array.from([5, 4, 3])),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
})();

function ctx(path: string, opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
  const request = new Request(path, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? (opts.body !== undefined ? { "content-type": "application/json" } : {}),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    env,
    params: opts.params ?? {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  env = { PORTALESS_SQLITE_PATH: DB, PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  const keyPair = await generateApwDid("ejemplo.com");
  const identityStore = await createSiteIdentityStore(env);
  await identityStore.create(SITE_ID, keyPair, "test");

  const res = await adminImages.onRequestPost(
    ctx("http://x.test/admin/api/cloud-images", {
      user: { username: "a", role: "admin" },
      method: "POST",
      body: { imageBase64: encodeBase64(PNG), declaredOrigin: "ai" }
    })
  );
  expect(res.status).toBe(201);
  imageId = (await res.json()).image.imageId;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("GET /images/:imageId", () => {
  it("404 para un imageId inexistente (con CORS)", async () => {
    const res = await serveImages.onRequestGet(ctx("http://x.test/images/no-existe", { params: { imageId: "no-existe" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("image_not_found");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("200 con cache immutable, ETag = contentHash y el sidecar embebido en los bytes", async () => {
    const res = await serveImages.onRequestGet(ctx(`http://x.test/images/${imageId}`, { params: { imageId } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toMatch(/^"sha256:[0-9a-f]{64}"$/);

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(PNG.length);
    const { extractPng } = await import("../../packages/cloud-images/src/png");
    const embedded = JSON.parse(extractPng(bytes) ?? "null");
    expect(embedded?.payload?.imageId).toBe(imageId);

    const res2 = await serveImages.onRequestGet(ctx(`http://x.test/images/${imageId}`, { params: { imageId } }));
    expect(res2.headers.get("etag")).toBe(res.headers.get("etag"));
  });

  it("304 con If-None-Match", async () => {
    const first = await serveImages.onRequestGet(ctx(`http://x.test/images/${imageId}`, { params: { imageId } }));
    const etag = first.headers.get("etag")!;
    const res = await serveImages.onRequestGet(
      ctx(`http://x.test/images/${imageId}`, { params: { imageId }, headers: { "if-none-match": etag } })
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
  });
});

describe("GET /trust/images/:imageId", () => {
  it("404 para un imageId inexistente", async () => {
    const res = await trustImages.onRequestGet(ctx("http://x.test/trust/images/no-existe", { params: { imageId: "no-existe" } }));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("verificacion valida: firma, embed y contentHash contra el registro local", async () => {
    const res = await trustImages.onRequestGet(ctx(`http://x.test/trust/images/${imageId}`, { params: { imageId } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verification).toMatchObject({
      valid: true,
      signature: { valid: true },
      embedded: { status: "match" },
      contentHash: { status: "match" },
      keySource: "local_store",
    });
    expect(body.image).toMatchObject({ imageId, declaredOrigin: "ai", contentType: "image/png" });
    expect(body.image.sidecar.payload.siteDid).toBe("did:apw:ejemplo.com");
    expect(body.image.trust).not.toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("sobrevive la rotacion de clave: la firma vieja sigue valida via listKeys", async () => {
    const identityStore = await createSiteIdentityStore(env);
    const nueva = await generateApwDid("ejemplo.com");
    const rotated = await identityStore.rotate(SITE_ID, nueva, "test");
    expect(rotated.did).toBe("did:apw:ejemplo.com");

    const res = await trustImages.onRequestGet(ctx(`http://x.test/trust/images/${imageId}`, { params: { imageId } }));
    const body = await res.json();
    expect(body.verification.valid).toBe(true);
    expect(body.verification.signature.valid).toBe(true);
  });
});
