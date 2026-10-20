// functions/admin/api/cloud-images.js: upload end-to-end con sqlite
// temporal + identidad did:apw real (generateApwDid + la misma clave de
// cifrado que usa site_identity). Cubre 401/403, todas las validaciones
// 400, 404 sin identidad, happy path con firma verificada + embed pAPW,
// dedupe por content hash, listado y baja.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { applySchema } from "../../scripts/setup.mjs";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { createSiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/store-factory";
import { verifyCloudImageSidecar } from "../../packages/cloud-images/src/sign";
import { extractPng, stripPng, crc32, PNG_SIGNATURE } from "../../packages/cloud-images/src/png";
import { sha256Hash, encodeBase64, decodeBase64, MAX_IMAGE_BYTES } from "../../packages/cloud-images/src/payload";
import * as images from "../../functions/admin/api/cloud-images";

const SITE_ID = "default";
const tmp = mkdtempSync(join(tmpdir(), "portaless-admin-cloud-images-"));
const DB = join(tmp, "portaless.db");
// Schema aplicado UNA vez en beforeAll (no dentro del test): el schema.sql
// completo dentro del body de un test roza el timeout de 5s bajo carga del
// runner -- mismo patron que tests/unit/mcp-agent-token-store.test.ts.
const OTRO_DB = join(tmp, "sin-identidad.db");
const ENV_KEY = randomBytes(32).toString("base64");

let env: Record<string, unknown>;
let identityDid: string;
let publicKeyJwk: JsonWebKey;
let kid: string;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function minimalPng(): Uint8Array {
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("IDAT", Uint8Array.from([9, 8, 7])),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const PNG = minimalPng();

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string; env?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
  const request = new Request("http://x.test/admin/api/cloud-images", {
    method: opts.method ?? "POST",
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    env: opts.env ?? env,
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

const admin = { username: "a", role: "admin" };
const viewer = { username: "v", role: "viewer" };

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  await applySchema(OTRO_DB, { quiet: true });
  env = { PORTALESS_SQLITE_PATH: DB, PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: ENV_KEY };
  const keyPair = await generateApwDid("ejemplo.com");
  identityDid = keyPair.did;
  publicKeyJwk = keyPair.publicKeyJwk;
  const identityStore = await createSiteIdentityStore(env);
  const record = await identityStore.create(SITE_ID, keyPair, "test");
  kid = record.did + "#key-1";
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("POST /admin/api/cloud-images", () => {
  it("401 sin sesion y 403 para viewer", async () => {
    expect((await images.onRequestPost(ctx({ user: null, body: {} }))).status).toBe(401);
    expect((await images.onRequestPost(ctx({ user: viewer, body: {} }))).status).toBe(403);
  });

  it("validaciones 400: json, declaredOrigin obligatorio, imagen, teto y tipo", async () => {
    const badJson = ctx({ user: admin });
    (badJson.request as Request) = new Request("http://x.test/admin/api/cloud-images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{basura",
    });
    expect((await images.onRequestPost(badJson)).status).toBe(400);

    const sinOrigen = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(PNG) } }));
    expect(sinOrigen.status).toBe(400);
    expect((await sinOrigen.json()).error).toBe("invalid_declared_origin");

    const origenMalo = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(PNG), declaredOrigin: "alien" } }));
    expect((await origenMalo.json()).error).toBe("invalid_declared_origin");

    const noBase64 = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: "!!nope!!", declaredOrigin: "ai" } }));
    expect((await noBase64.json()).error).toBe("invalid_image");

    const vacia = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(new Uint8Array(0)), declaredOrigin: "ai" } }));
    expect((await vacia.json()).error).toBe("invalid_image");

    const grande = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(new Uint8Array(MAX_IMAGE_BYTES + 1)), declaredOrigin: "ai" } }));
    expect(grande.status).toBe(400);
    expect((await grande.json()).error).toBe("image_too_large");

    const texto = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(new TextEncoder().encode("hola")), declaredOrigin: "ai" } }));
    expect((await texto.json()).error).toBe("unsupported_content_type");
  });

  it("404 site_identity_not_found en un entorno sin identidad", async () => {
    const res = await images.onRequestPost(
      ctx({ user: admin, body: { imageBase64: encodeBase64(PNG), declaredOrigin: "ai" }, env: { PORTALESS_SQLITE_PATH: OTRO_DB, PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: ENV_KEY } })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("site_identity_not_found");
  });

  it("happy path: firma automatica con la clave activa + embed pAPW + trust capturado", async () => {
    const res = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(PNG), declaredOrigin: "ai" } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deduplicated).toBe(false);

    const record = body.image;
    expect(record).toMatchObject({
      contentType: "image/png",
      byteLength: PNG.length,
      declaredOrigin: "ai",
      siteId: SITE_ID,
      siteDid: identityDid,
      keyId: kid,
      keyAlgorithm: "ed25519",
      createdBy: "a",
    });
    expect(record.contentHash).toBe(await sha256Hash(PNG));
    expect(record.imageId).toMatch(/^img-/);
    expect(record.sidecar.payload.trust).not.toBeNull();
    expect(record.sidecar.payload.trust.counts).toEqual({ self: 0, agent: 0, community: 0, escrowReports: 0 });

    const signature = await verifyCloudImageSidecar(record.sidecar, [{ keyId: kid, kid, publicKeyJwk }]);
    expect(signature.ok).toBe(true);

    const storeBytes = (await (await import("../../packages/cloud-images/src/store")).createCloudImageStore(env)).get(record.imageId);
    const entry = await storeBytes;
    expect(entry).not.toBeNull();
    expect(extractPng(entry!.bytes)).toBe(JSON.stringify(record.sidecar));
    expect(stripPng(entry!.bytes)).toEqual(PNG);
  });

  it("dedupe por content hash: la misma imagen devuelve la registrada", async () => {
    const res = await images.onRequestPost(ctx({ user: admin, body: { imageBase64: encodeBase64(PNG), declaredOrigin: "human" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduplicated).toBe(true);
    expect(body.image.declaredOrigin).toBe("ai");
  });

  it("limita escrituras por admin y por IP", async () => {
    const limitedAdmin = { username: "rate-limited-admin", role: "admin" };
    const headers = { "cf-connecting-ip": "198.51.100.222" };
    for (let i = 0; i < 10; i++) {
      const res = await images.onRequestPost(ctx({
        user: limitedAdmin,
        body: { imageBase64: encodeBase64(PNG), declaredOrigin: "ai" },
        headers,
      }));
      expect(res.status).toBeLessThan(400);
    }
    const blocked = await images.onRequestPost(ctx({
      user: limitedAdmin,
      body: { imageBase64: encodeBase64(PNG), declaredOrigin: "ai" },
      headers,
    }));
    expect(blocked.status).toBe(429);
  });
});

describe("GET/DELETE /admin/api/cloud-images", () => {
  it("GET exige sesion y lista sin inventar campos", async () => {
    expect((await images.onRequestGet(ctx({ user: null }))).status).toBe(401);
    const body = await (await images.onRequestGet(ctx({ user: viewer }))).json();
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({ declaredOrigin: "ai", siteDid: identityDid });
    expect(body.images[0].bytes).toBeUndefined();
  });

  it("DELETE: 401/403/400 y baja booleana", async () => {
    expect((await images.onRequestDelete(ctx({ user: null, body: { imageId: "x" } }))).status).toBe(401);
    expect((await images.onRequestDelete(ctx({ user: viewer, body: { imageId: "x" } }))).status).toBe(403);
    expect((await images.onRequestDelete(ctx({ user: admin, body: {} }))).status).toBe(400);

    const list = await (await images.onRequestGet(ctx({ user: admin }))).json();
    const imageId = list.images[0].imageId;
    expect((await (await images.onRequestDelete(ctx({ user: admin, body: { imageId } }))).json()).removed).toBe(true);
    expect((await (await images.onRequestDelete(ctx({ user: admin, body: { imageId } }))).json()).removed).toBe(false);
    expect((await (await images.onRequestGet(ctx({ user: admin }))).json()).images).toHaveLength(0);
  });
});
