// APW v1.2 (5.3, ERRATA E-4): atestaciones firmadas por el emisor en
// agent-verification y escrow-report, verificacion del JWS, coincidencia con
// el cuerpo plano, jti unico y registro en el historial encadenado.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  trust: null as any,
  escrow: null as any,
  identity: null as any,
  log: null as any,
  agentJwk: null as any,
  agentKid: "agent-kid-1",
}));

vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => state.trust,
}));
vi.mock("../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, createAuthorizedEscrowProvidersStore: async () => state.escrow };
});
vi.mock("../../packages/trust-layer/src/site-trust/authorized-agents.ts", () => ({
  createAuthorizedAgentsStore: async () => ({ isAuthorized: async () => true }),
}));
vi.mock("../../packages/trust-layer/src/site-trust/web-bot-auth.ts", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    verifyWebBotAuthRequest: async () => ({ verified: true, agentKeyId: state.agentKid, keyAlgorithm: "ed25519" }),
    resolveAgentDirectoryKey: async (_signatureAgent: string, keyId: string) => (keyId === state.agentKid ? state.agentJwk : null),
  };
});
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => state.identity,
  createAttestationLogStore: async () => state.log,
}));

import { ATTESTATION_TYP, verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation";
import { InMemorySiteTrustScoreStore, DUPLICATE_ATTESTATION_JTI } from "../../packages/trust-layer/src/site-trust/site-trust-score";
import {
  InMemoryAuthorizedEscrowProvidersStore,
  normalizeProviderPublicKey,
} from "../../packages/trust-layer/src/site-trust/authorized-escrow-providers";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";

const SITE = "ejemplo.com";
const SUB = `did:apw:${SITE}`;
const AGENT_ORIGIN = "https://agent.example";
const PROVIDER = "escrow-acme";
const ENV = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };

const b64 = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

async function newEd25519() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
  };
}

async function sign(header: object, payload: object, privateJwk: JsonWebKey): Promise<string> {
  const h = b64(JSON.stringify(header));
  const p = b64(JSON.stringify(payload));
  const { kty, crv, x, d } = privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x, d } as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64(sig)}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    typ: ATTESTATION_TYP,
    iss: PROVIDER,
    sub: SUB,
    src: "escrow_report",
    cat: "completed_as_promised",
    val: true,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...overrides,
  };
}

async function setupSiteIdentity() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  await state.identity.create("default", { did: SUB, domain: SITE, publicKeyJwk, privateKeyJwk, didDocument: buildDidDocument(SUB, publicKeyJwk) }, "admin");
}

beforeEach(async () => {
  state.trust = new InMemorySiteTrustScoreStore();
  state.escrow = new InMemoryAuthorizedEscrowProvidersStore();
  state.identity = new InMemorySiteIdentityStore(ENV);
  state.log = new InMemoryAttestationLogStore();
  await setupSiteIdentity();
});

describe("verifyAttestation", () => {
  const expected = { sub: SUB, src: "escrow_report" as const, iss: PROVIDER };

  it("acepta una atestacion bien firmada y devuelve los claims", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    const payload = claims();
    const jws = await sign({ alg: "EdDSA", typ: ATTESTATION_TYP }, payload, privateJwk);
    const result = await verifyAttestation(jws, publicJwk, expected);
    expect(result).toEqual({ ok: true, claims: payload });
  });

  it("rechaza firma ajena, alg distinto, typ distinto y payload alterado", async () => {
    const signer = await newEd25519();
    const other = await newEd25519();
    const jws = await sign({ alg: "EdDSA" }, claims(), signer.privateJwk);
    expect(await verifyAttestation(jws, other.publicJwk, expected)).toEqual({ ok: false, reason: "bad_signature" });

    const wrongAlg = await sign({ alg: "ES256" }, claims(), signer.privateJwk);
    expect(await verifyAttestation(wrongAlg, signer.publicJwk, expected)).toEqual({ ok: false, reason: "unsupported_alg" });

    const wrongTyp = await sign({ alg: "EdDSA" }, claims({ typ: "JWT" }), signer.privateJwk);
    expect(await verifyAttestation(wrongTyp, signer.publicJwk, expected)).toEqual({ ok: false, reason: "invalid_typ" });

    const [h, , s] = jws.split(".");
    const tampered = `${h}.${b64(JSON.stringify(claims({ val: false })))}.${s}`;
    expect(await verifyAttestation(tampered, signer.publicJwk, expected)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rechaza sub, src, iss, kid e iat fuera de lo esperado", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    const check = async (payload: object, exp: any = expected, header: object = { alg: "EdDSA" }) =>
      verifyAttestation(await sign(header, payload, privateJwk), publicJwk, exp);

    expect(await check(claims({ sub: "did:apw:otro.com" }))).toEqual({ ok: false, reason: "sub_mismatch" });
    expect(await check(claims({ src: "agent" }))).toEqual({ ok: false, reason: "src_mismatch" });
    expect(await check(claims({ iss: "otro-proveedor" }))).toEqual({ ok: false, reason: "iss_mismatch" });
    expect(await check(claims({ iat: Math.floor(Date.now() / 1000) - 3600 }))).toEqual({ ok: false, reason: "iat_out_of_window" });
    expect(await check(claims({ val: "si" }))).toEqual({ ok: false, reason: "invalid_claims" });
    expect(await check(claims(), { ...expected, kid: "k1" }, { alg: "EdDSA", kid: "k2" })).toEqual({ ok: false, reason: "kid_mismatch" });
  });

  it("compara iss por origen cuando es una URL https", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    const jws = await sign({ alg: "EdDSA" }, claims({ iss: `${AGENT_ORIGIN}/`, src: "agent" }), privateJwk);
    expect((await verifyAttestation(jws, publicJwk, { sub: SUB, src: "agent", iss: AGENT_ORIGIN })).ok).toBe(true);
  });

  it("rechaza claves que no son Ed25519 y JWS mal formados", async () => {
    const { privateJwk } = await newEd25519();
    const jws = await sign({ alg: "EdDSA" }, claims(), privateJwk);
    expect(await verifyAttestation(jws, { kty: "AKP", alg: "ML-DSA-44" } as JsonWebKey, expected)).toEqual({ ok: false, reason: "unsupported_key" });
    expect(await verifyAttestation("no-es-un-jws", privateJwk, expected)).toEqual({ ok: false, reason: "malformed_attestation" });
  });
});

describe("normalizeProviderPublicKey", () => {
  it("acepta Ed25519 publica y rechaza privada o de otro tipo", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    expect(normalizeProviderPublicKey(JSON.stringify(publicJwk))).toEqual({ kty: "OKP", crv: "Ed25519", x: publicJwk.x });
    expect(() => normalizeProviderPublicKey(privateJwk)).toThrow("invalid_public_key_jwk");
    expect(() => normalizeProviderPublicKey({ kty: "EC", crv: "P-256", x: "a" })).toThrow("invalid_public_key_jwk");
  });
});

describe("InMemorySiteTrustScoreStore: jti unico por emisor", () => {
  it("rechaza el mismo jti del mismo proveedor, aun en otro sitio", async () => {
    const store = new InMemorySiteTrustScoreStore();
    const base = { transactionOutcome: "completed_as_promised" as const, escrowProvider: PROVIDER, reportedAt: new Date().toISOString(), attestationJti: "j-1" };
    await store.recordEscrowReport({ siteId: "a.com", ...base });
    await expect(store.recordEscrowReport({ siteId: "b.com", ...base })).rejects.toThrow(DUPLICATE_ATTESTATION_JTI);
    await store.recordEscrowReport({ siteId: "a.com", ...base, escrowProvider: "otro" });
  });
});

describe("POST /trust/:siteId/escrow-report con atestacion", () => {
  async function setupProvider() {
    const keys = await newEd25519();
    const { apiKey } = await state.escrow.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin", publicKeyJwk: keys.publicJwk });
    return { ...keys, apiKey };
  }

  async function post(apiKey: string, body: object) {
    const { onRequestPost } = await import("../../functions/trust/[siteId]/escrow-report.js");
    const request = new Request(`https://${SITE}/trust/${SITE}/escrow-report`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return onRequestPost({ request, env: {}, params: { siteId: SITE } });
  }

  it("guarda el reporte con su JWS y lo anota en el historial", async () => {
    const { privateJwk, apiKey } = await setupProvider();
    const attestation = await sign({ alg: "EdDSA", typ: ATTESTATION_TYP }, claims(), privateJwk);
    const res = await post(apiKey, { escrowProvider: PROVIDER, transactionOutcome: "completed_as_promised", attestation });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, logged: true });
    const snapshot = await state.trust.getSnapshot(SITE);
    expect(snapshot.escrowReports).toHaveLength(1);
    expect(snapshot.escrowReports[0].attestationJws).toBe(attestation);
    expect((await state.log.list("default", 1, 10)).length).toBe(1);
  });

  it("rechaza el reporte si el cuerpo no coincide con la atestacion", async () => {
    const { privateJwk, apiKey } = await setupProvider();
    const attestation = await sign({ alg: "EdDSA" }, claims({ cat: "disputed" }), privateJwk);
    const res = await post(apiKey, { escrowProvider: PROVIDER, transactionOutcome: "completed_as_promised", attestation });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("attestation_mismatch");
    expect((await state.trust.getSnapshot(SITE)).escrowReports).toHaveLength(0);
  });

  it("responde 409 si el jti se repite", async () => {
    const { privateJwk, apiKey } = await setupProvider();
    const payload = claims();
    const first = await sign({ alg: "EdDSA" }, payload, privateJwk);
    const second = await sign({ alg: "EdDSA", typ: ATTESTATION_TYP }, payload, privateJwk);
    expect((await post(apiKey, { escrowProvider: PROVIDER, transactionOutcome: "completed_as_promised", attestation: first })).status).toBe(200);
    expect((await post(apiKey, { escrowProvider: PROVIDER, transactionOutcome: "completed_as_promised", attestation: second })).status).toBe(409);
  });

  it("exige atestacion y clave publica registrada", async () => {
    const { apiKey } = await setupProvider();
    const missing = await post(apiKey, { escrowProvider: PROVIDER, transactionOutcome: "completed_as_promised" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("missing_attestation");

    const { apiKey: keyWithoutPub } = await state.escrow.grant({ providerId: "sin-clave", displayName: "Sin clave", authorizedBy: "admin" });
    const { privateJwk } = await newEd25519();
    const attestation = await sign({ alg: "EdDSA" }, claims({ iss: "sin-clave" }), privateJwk);
    const res = await post(keyWithoutPub, { escrowProvider: "sin-clave", transactionOutcome: "completed_as_promised", attestation });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("provider_without_public_key");
  });
});

describe("POST /trust/:siteId/agent-verification con atestacion", () => {
  async function post(body: object) {
    const { onRequestPost } = await import("../../functions/trust/[siteId]/agent-verification.js");
    const request = new Request(`https://${SITE}/trust/${SITE}/agent-verification`, {
      method: "POST",
      headers: { "content-type": "application/json", "signature-agent": `"${AGENT_ORIGIN}"` },
      body: JSON.stringify(body),
    });
    return onRequestPost({ request, env: {}, params: { siteId: SITE } });
  }

  function agentClaims(overrides: Record<string, unknown> = {}) {
    return claims({ iss: AGENT_ORIGIN, src: "agent", cat: "https_and_headers", val: false, ...overrides });
  }

  it("guarda la verificacion firmada con la clave del directorio del agente", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    state.agentJwk = publicJwk;
    const attestation = await sign({ alg: "EdDSA", kid: state.agentKid }, agentClaims(), privateJwk);
    const res = await post({ category: "https_and_headers", verified: false, attestation });

    expect(res.status).toBe(200);
    const [row] = (await state.trust.getSnapshot(SITE)).agent;
    expect(row).toMatchObject({ verified: false, agentKeyId: state.agentKid, attestationJws: attestation });
  });

  it("rechaza un verified distinto del firmado, un iss ajeno y un kid distinto", async () => {
    const { privateJwk, publicJwk } = await newEd25519();
    state.agentJwk = publicJwk;

    const mismatch = await sign({ alg: "EdDSA", kid: state.agentKid }, agentClaims(), privateJwk);
    const r1 = await post({ category: "https_and_headers", verified: true, attestation: mismatch });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("attestation_mismatch");

    const foreign = await sign({ alg: "EdDSA", kid: state.agentKid }, agentClaims({ iss: "https://otro-agente.example" }), privateJwk);
    const r2 = await post({ category: "https_and_headers", verified: false, attestation: foreign });
    expect(await r2.json()).toMatchObject({ error: "invalid_attestation", reason: "iss_mismatch" });

    const wrongKid = await sign({ alg: "EdDSA", kid: "otra-clave" }, agentClaims(), privateJwk);
    const r3 = await post({ category: "https_and_headers", verified: false, attestation: wrongKid });
    expect(await r3.json()).toMatchObject({ error: "invalid_attestation", reason: "kid_mismatch" });

    expect((await state.trust.getSnapshot(SITE)).agent).toHaveLength(0);
  });
});
