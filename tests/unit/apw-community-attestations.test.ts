// Atestaciones comunitarias firmadas (APW v1.3, ERRATA E-13):
// store append-only (iss, jti) unico por emisor, y el endpoint
// POST /trust/:siteId/community-attestation. La identidad del emisor y su
// historial son I/O de red, asi que se sustituyen por el estado del test; la
// firma se verifica de verdad con verifyAttestation y una clave Ed25519 real.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  identity: {} as Record<string, any>,
  history: {} as Record<string, any>,
  env: {} as Record<string, unknown>,
}));

vi.mock("../../packages/apw-resolver/src/index.ts", () => ({
  resolveApwIdentity: async (domain: string) =>
    state.identity[domain] ?? { verified: false, reason: "manifest_without_key", domain, did: `did:apw:${domain}` },
}));

vi.mock("../../packages/apw-resolver/src/did-apw/history-resolver.ts", () => ({
  resolveApwHistory: async (domain: string) => state.history[domain] ?? { verified: false, reason: "no_history", domain },
}));

import { ATTESTATION_TYP } from "../../packages/trust-layer/src/site-trust/attestation";
import {
  InMemoryCommunityAttestationsStore,
  DUPLICATE_COMMUNITY_JTI,
} from "../../packages/trust-layer/src/site-trust/community-attestations";
import * as endpoint from "../../functions/trust/[siteId]/community-attestation";

const SITE = "ejemplo.com";
const SUB = `did:apw:${SITE}`;
const EMITTER = "veracier.example";
const EMITTER_DID = `did:apw:${EMITTER}`;
const FIRST_SEEN_TS = new Date("2026-01-01T00:00:00.000Z").toISOString();
const NOW = () => Math.floor(Date.now() / 1000);

const b64 = (data: Uint8Array | string) => Buffer.from(data as never).toString("base64url");

async function newEd25519() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
  };
}

async function signAttestation(privateJwk: JsonWebKey, overrides: Record<string, unknown> = {}) {
  const payload = {
    typ: ATTESTATION_TYP,
    iss: EMITTER_DID,
    sub: SUB,
    src: "community",
    cat: "content_accuracy",
    val: 4,
    iat: NOW(),
    jti: crypto.randomUUID(),
    ...overrides,
  };
  const h = b64(JSON.stringify({ alg: "EdDSA", typ: ATTESTATION_TYP }));
  const p = b64(JSON.stringify(payload));
  const { kty, crv, x, d } = privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x, d } as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(`${h}.${p}`)));
  return { jws: `${h}.${p}.${b64(sig)}`, payload };
}

function ctx(body: unknown, siteId: string | null = SITE) {
  return {
    request: new Request("http://x.test/trust/ejemplo.com/community-attestation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env: state.env,
    params: siteId === null ? {} : { siteId },
  } as any;
}

// El store InMemory se recrea en cada request (factory sin DB), asi que el
// test usa SQLite real para que 409 y 429 puedan observarse entre llamadas.
const tmp = mkdtempSync(join(tmpdir(), "portaless-community-"));
let dbSeq = 0;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  // Un archivo por test: el rate-limit y la unicidad persisten en SQLite, asi
  // que compartir el archivo filtraria estado entre casos.
  dbSeq += 1;
  state.env = { PORTALESS_SQLITE_PATH: join(tmp, `community-${dbSeq}.db`) };
  state.identity = {};
  state.history = {};
});

describe("InMemoryCommunityAttestationsStore (E-13)", () => {
  const input = {
    iss: EMITTER_DID,
    jti: "j1",
    siteId: SITE,
    sub: SUB,
    category: "content_accuracy",
    val: 4,
    iat: 1800000000,
    jws: "h.p.s",
    emitterFirstSeenIat: 1700000000,
    receivedAt: "2026-10-15T00:00:00.000Z",
  };

  it("registra, lista por sitio y por emisor, y expone has()", async () => {
    const store = new InMemoryCommunityAttestationsStore();
    await store.record(input);
    expect(await store.has(EMITTER_DID, "j1")).toBe(true);
    expect(await store.has(EMITTER_DID, "j2")).toBe(false);
    expect(await store.listBySite(SITE)).toHaveLength(1);
    expect(await store.listByEmitter(EMITTER_DID)).toHaveLength(1);
    expect(await store.listByEmitter(EMITTER_DID, "otro.com")).toHaveLength(0);
  });

  it("(iss, jti) es unico por emisor: repetir el mismo lanza", async () => {
    const store = new InMemoryCommunityAttestationsStore();
    await store.record(input);
    await expect(store.record(input)).rejects.toThrow(DUPLICATE_COMMUNITY_JTI);
    // Otro emisor con el mismo jti si entra: la unicidad es POR emisor.
    await expect(store.record({ ...input, iss: "did:apw:otro.example" })).resolves.toBeDefined();
  });
});

describe("POST /trust/:siteId/community-attestation (E-13)", () => {
  let keys: { privateJwk: JsonWebKey; publicJwk: JsonWebKey };

  beforeEach(async () => {
    keys = await newEd25519();
    state.identity[EMITTER] = {
      verified: true,
      reason: "ok",
      domain: EMITTER,
      did: EMITTER_DID,
      didDocument: { id: EMITTER_DID, verificationMethod: [{ publicKeyJwk: keys.publicJwk }] },
    };
    state.history[EMITTER] = { verified: true, reason: "ok", domain: EMITTER, attestations: [{ seq: 1, ts: FIRST_SEEN_TS }] };
  });

  it("400 sin siteId, 400 JSON roto, 401 sin attestation", async () => {
    const { jws } = await signAttestation(keys.privateJwk);
    expect((await endpoint.onRequestPost(ctx({ attestation: jws }, null))).status).toBe(400);
    expect((await endpoint.onRequestPost(ctx("{"))).status).toBe(400);
    expect((await endpoint.onRequestPost(ctx({}))).status).toBe(401);
  });

  it("400 si el iss no es did:apw, 403 si el emisor no resuelve", async () => {
    const { jws } = await signAttestation(keys.privateJwk, { iss: "https://agente.example" });
    const noDid = await endpoint.onRequestPost(ctx({ attestation: jws }));
    expect(noDid.status).toBe(400);
    expect((await noDid.json()).error).toBe("invalid_issuer");

    delete state.identity[EMITTER];
    const { jws: jws2 } = await signAttestation(keys.privateJwk);
    const unresolved = await endpoint.onRequestPost(ctx({ attestation: jws2 }));
    expect(unresolved.status).toBe(403);
    expect((await unresolved.json()).error).toBe("issuer_unresolvable");
  });

  it("400 si la firma es de otra clave, el sub no es el sitio, o val sale de 1..5", async () => {
    const other = await newEd25519();
    const { jws: foreign } = await signAttestation(other.privateJwk);
    expect((await endpoint.onRequestPost(ctx({ attestation: foreign }))).status).toBe(400);

    const { jws: wrongSub } = await signAttestation(keys.privateJwk, { sub: "did:apw:otro.com" });
    expect((await endpoint.onRequestPost(ctx({ attestation: wrongSub }))).status).toBe(400);

    const { jws: badVal } = await signAttestation(keys.privateJwk, { val: 9 });
    expect((await endpoint.onRequestPost(ctx({ attestation: badVal }))).status).toBe(400);
  });

  it("400 si la categoria no es de community", async () => {
    const { jws } = await signAttestation(keys.privateJwk, { cat: "privacy_policy" });
    const res = await endpoint.onRequestPost(ctx({ attestation: jws }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_category");
  });

  it("200 registra la atestacion y captura la antiguedad del emisor", async () => {
    const { jws, payload } = await signAttestation(keys.privateJwk);
    const res = await endpoint.onRequestPost(ctx({ attestation: jws }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.attestation).toMatchObject({
      iss: EMITTER_DID,
      jti: payload.jti,
      category: "content_accuracy",
      val: 4,
      emitterFirstSeenIat: Math.floor(Date.parse(FIRST_SEEN_TS) / 1000),
    });
  });

  it("emitterFirstSeenIat es null si el historial no resuelve (fail-closed)", async () => {
    state.history[EMITTER] = { verified: false, reason: "no_history", domain: EMITTER };
    const { jws } = await signAttestation(keys.privateJwk);
    const res = await endpoint.onRequestPost(ctx({ attestation: jws }));
    expect(res.status).toBe(200);
    expect((await res.json()).attestation.emitterFirstSeenIat).toBeNull();
  });

  it("409 si el emisor repite el jti", async () => {
    const { jws } = await signAttestation(keys.privateJwk);
    expect((await endpoint.onRequestPost(ctx({ attestation: jws }))).status).toBe(200);
    const again = await endpoint.onRequestPost(ctx({ attestation: jws }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("duplicate_attestation");
  });

  it("429 si el mismo emisor reemite la misma categoria antes de 24h", async () => {
    const { jws } = await signAttestation(keys.privateJwk, { cat: "responsiveness" });
    expect((await endpoint.onRequestPost(ctx({ attestation: jws }))).status).toBe(200);
    const { jws: second } = await signAttestation(keys.privateJwk, { cat: "responsiveness" });
    const limited = await endpoint.onRequestPost(ctx({ attestation: second }));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
  });
});
