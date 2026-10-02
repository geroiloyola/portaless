// APW v1.2 (B1 y B2): huella RFC 7638, manifiesto v2, did.json publico y
// verificacion cruzada TXT + did.json.
import { afterEach, describe, expect, it, vi } from "vitest";
import { jwkThumbprint, publicJwkMembers } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { buildApwManifest, parseApwManifest, serializeApwManifest } from "../../packages/apw-resolver/src/manifest";
import { resolveApwIdentity } from "../../packages/apw-resolver/src/index";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";

const state = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => ({ get: async () => state.identity }),
}));

const RFC8037_X = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";
const RFC8037_THUMB = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";
const RFC9421_X = "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs";
const RFC9421_THUMB = "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";

afterEach(() => {
  vi.restoreAllMocks();
  state.identity = null;
});

describe("jwkThumbprint (RFC 7638)", () => {
  it("coincide con los vectores de RFC 8037 y RFC 9421", async () => {
    expect(await jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: RFC8037_X })).toBe(RFC8037_THUMB);
    expect(await jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: RFC9421_X })).toBe(RFC9421_THUMB);
  });

  it("ignora miembros opcionales y privados", async () => {
    const jwk = { kty: "OKP", crv: "Ed25519", x: RFC8037_X, d: "secreto", key_ops: ["verify"], ext: true, kid: "k1" } as JsonWebKey;
    expect(await jwkThumbprint(jwk)).toBe(RFC8037_THUMB);
    expect(publicJwkMembers(jwk)).toEqual({ crv: "Ed25519", kty: "OKP", x: RFC8037_X });
  });

  it("rechaza claves sin tipo soportado o incompletas", async () => {
    await expect(jwkThumbprint({ kty: "oct" } as JsonWebKey)).rejects.toThrow("unsupported_key_type");
    await expect(jwkThumbprint({ kty: "OKP", crv: "Ed25519" } as JsonWebKey)).rejects.toThrow("missing_jwk_member:x");
  });
});

describe("manifiesto v2", () => {
  it("con k genera v2; sin k sigue siendo v1", () => {
    expect(buildApwManifest({ siteId: "s", contentKinds: ["mixed"] }).v).toBe(1);
    const v2 = buildApwManifest({ siteId: "s", contentKinds: ["mixed"], k: RFC8037_THUMB });
    expect(v2).toMatchObject({ v: 2, k: RFC8037_THUMB });
    expect(parseApwManifest(serializeApwManifest(v2))).toEqual({ valid: true, manifest: v2 });
  });

  it("valida k, h y rg en v2 e ignora esos campos en v1", () => {
    const base = { siteId: "s", trustUrl: "/trust/s", contentKinds: ["mixed"] };
    expect(parseApwManifest(JSON.stringify({ ...base, v: 2, k: "corta" })).error).toBe("invalid_key_fingerprint");
    expect(parseApwManifest(JSON.stringify({ ...base, v: 2, h: 5 })).error).toBe("invalid_history_head");
    expect(parseApwManifest(JSON.stringify({ ...base, v: 2, rg: "si" })).error).toBe("invalid_read_governance");
    const v1 = parseApwManifest(JSON.stringify({ ...base, v: 1, k: RFC8037_THUMB }));
    expect(v1.valid).toBe(true);
    expect(v1.manifest?.k).toBeUndefined();
  });
});

describe("resolveApwIdentity: TXT + did.json deben coincidir", () => {
  const DOMAIN = "ejemplo.com";
  const jwk = { kty: "OKP", crv: "Ed25519", x: RFC8037_X } as JsonWebKey;

  function doh(txt: string) {
    return { ok: true, json: async () => ({ Status: 0, Answer: [{ name: `_apw.${DOMAIN}.`, type: 16, TTL: 300, data: `"${txt.replace(/"/g, '\\"')}"` }] }) };
  }
  function didResponse(doc: unknown, ok = true) {
    return { ok, json: async () => doc };
  }
  const manifestWith = (k?: string) => serializeApwManifest(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], ...(k ? { k } : {}) }));

  it("verifica cuando la huella del did.json es igual a k", async () => {
    const f = vi.fn().mockResolvedValueOnce(doh(manifestWith(RFC8037_THUMB))).mockResolvedValueOnce(didResponse(buildDidDocument(`did:apw:${DOMAIN}`, jwk)));
    const result = await resolveApwIdentity(DOMAIN, f as unknown as typeof fetch);
    expect(result).toMatchObject({ verified: true, reason: "ok", did: `did:apw:${DOMAIN}`, keyThumbprint: RFC8037_THUMB });
    expect(String(f.mock.calls[1][0])).toBe(`https://${DOMAIN}/.well-known/did.json`);
  });

  it("rechaza si la clave del did.json no corresponde a k", async () => {
    const otra = { kty: "OKP", crv: "Ed25519", x: RFC9421_X } as JsonWebKey;
    const f = vi.fn().mockResolvedValueOnce(doh(manifestWith(RFC8037_THUMB))).mockResolvedValueOnce(didResponse(buildDidDocument(`did:apw:${DOMAIN}`, otra)));
    expect((await resolveApwIdentity(DOMAIN, f as unknown as typeof fetch)).reason).toBe("key_mismatch");
  });

  it("rechaza un did.json de otro dominio", async () => {
    const f = vi.fn().mockResolvedValueOnce(doh(manifestWith(RFC8037_THUMB))).mockResolvedValueOnce(didResponse(buildDidDocument("did:apw:otro.com", jwk)));
    expect((await resolveApwIdentity(DOMAIN, f as unknown as typeof fetch)).reason).toBe("did_mismatch");
  });

  it("informa manifiesto sin k, did.json caido y documento invalido", async () => {
    const sinK = vi.fn().mockResolvedValueOnce(doh(manifestWith()));
    expect((await resolveApwIdentity(DOMAIN, sinK as unknown as typeof fetch)).reason).toBe("manifest_without_key");
    expect(sinK).toHaveBeenCalledTimes(1);

    const caido = vi.fn().mockResolvedValueOnce(doh(manifestWith(RFC8037_THUMB))).mockResolvedValueOnce(didResponse(null, false));
    expect((await resolveApwIdentity(DOMAIN, caido as unknown as typeof fetch)).reason).toBe("did_document_unreachable");

    const invalido = vi.fn().mockResolvedValueOnce(doh(manifestWith(RFC8037_THUMB))).mockResolvedValueOnce(didResponse({ id: "x" }));
    expect((await resolveApwIdentity(DOMAIN, invalido as unknown as typeof fetch)).reason).toBe("invalid_did_document");
  });
});

describe("GET /.well-known/did.json", () => {
  it("devuelve el documento con solo la clave publica", async () => {
    state.identity = {
      did: "did:apw:ejemplo.com",
      domain: "ejemplo.com",
      publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: RFC8037_X, key_ops: ["verify"], ext: true, d: "NUNCA" },
    };
    const { onRequestGet } = await import("../../functions/.well-known/did.json.js");
    const res = await onRequestGet({ env: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/did+json");
    const text = await res.text();
    expect(text).not.toContain("NUNCA");
    const doc = JSON.parse(text);
    expect(doc.id).toBe("did:apw:ejemplo.com");
    expect(doc.verificationMethod[0].publicKeyJwk).toEqual({ crv: "Ed25519", kty: "OKP", x: RFC8037_X });
    expect(await jwkThumbprint(doc.verificationMethod[0].publicKeyJwk)).toBe(RFC8037_THUMB);
  });

  it("responde 404 si el sitio no tiene identidad", async () => {
    const { onRequestGet } = await import("../../functions/.well-known/did.json.js");
    const res = await onRequestGet({ env: {} });
    expect(res.status).toBe(404);
  });
});
