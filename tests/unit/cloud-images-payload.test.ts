// packages/cloud-images: formato de payload v1, sidecar { payload, jws },
// firma/verificacion Ed25519 reusando signSiteJws (JCS RFC 8785) con typ
// apw-image+jws. Cubre: vector sha256, validacion defensiva de payload,
// round-trip sign->verify, y TODOS los motivos de fallo (key_not_found,
// payload_mismatch con el payload alterado, bad_signature, invalid_typ,
// kid de otro did, kid legacy por huella RFC 7638).

import { describe, it, expect } from "vitest";
import {
  sha256Hash,
  buildCloudImagePayload,
  validatePayload,
  parseSidecar,
  decodeBase64,
  encodeBase64,
  MAX_IMAGE_BYTES,
  type CloudImagePayload,
} from "../../packages/cloud-images/src/payload";
import {
  signCloudImage,
  verifyCloudImageSidecar,
  decodeJwsHeader,
  imageKidBelongsToDid,
  IMAGE_TYP,
} from "../../packages/cloud-images/src/sign";
import { signSiteJws, jcs } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";

const SITE_DID = "did:apw:ejemplo.com";

async function signedWorld() {
  const keyPair = await generateApwDid("ejemplo.com");
  const key = { keyId: `${SITE_DID}#key-1`, privateKeyJwk: keyPair.privateKeyJwk };
  const payload = buildCloudImagePayload({
    imageId: "img-1",
    contentHash: await sha256Hash(new TextEncoder().encode("hola")),
    contentType: "image/png",
    byteLength: 4,
    declaredOrigin: "ai",
    siteId: "default",
    siteDid: SITE_DID,
    signedAt: new Date().toISOString(),
    trust: null,
  });
  const jws = await signCloudImage(payload, key);
  return { keyPair, key, payload, sidecar: { payload, jws } };
}

describe("sha256Hash / decodeBase64", () => {
  it("vector conocido de SHA-256 y formato sha256:<hex>", async () => {
    const hash = await sha256Hash(new TextEncoder().encode("abc"));
    expect(hash).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("base64 round-trip y rechazo de basura", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    expect(decodeBase64("no-es-base64!!")).toBeNull();
    expect(decodeBase64("")).toBeNull();
    expect(decodeBase64(42)).toBeNull();
  });
});

describe("buildCloudImagePayload / validatePayload", () => {
  const base = {
    imageId: "img-1",
    contentHash: "sha256:" + "a".repeat(64),
    contentType: "image/png",
    byteLength: 100,
    declaredOrigin: "mixed" as const,
    siteId: "default",
    siteDid: SITE_DID,
    signedAt: "2026-10-12T00:00:00.000Z",
    trust: null,
  };

  it("construye el payload v1 con keyAlgorithm ed25519", () => {
    const payload = buildCloudImagePayload(base);
    expect(payload).toMatchObject({ v: 1, ...base, keyAlgorithm: "ed25519" });
    expect(validatePayload(payload)).not.toBeNull();
  });

  it("lanza ante inputs del servidor invalidos", () => {
    expect(() => buildCloudImagePayload({ ...base, imageId: "con espacios!" })).toThrow("invalid_image_id");
    expect(() => buildCloudImagePayload({ ...base, contentHash: "md5:x" })).toThrow("invalid_content_hash");
    expect(() => buildCloudImagePayload({ ...base, contentType: "application/pdf" })).toThrow("invalid_content_type");
    expect(() => buildCloudImagePayload({ ...base, byteLength: 0 })).toThrow("invalid_byte_length");
    expect(() => buildCloudImagePayload({ ...base, byteLength: MAX_IMAGE_BYTES + 1 })).toThrow("invalid_byte_length");
    expect(() => buildCloudImagePayload({ ...base, declaredOrigin: "robot" as never })).toThrow("invalid_declared_origin");
    expect(() => buildCloudImagePayload({ ...base, siteDid: "did:web:ejemplo.com" })).toThrow("invalid_site_did");
    expect(() => buildCloudImagePayload({ ...base, signedAt: "ayer" })).toThrow("invalid_signed_at");
  });

  it("validatePayload es defensivo ante cualquier shape hostil", () => {
    const payload = buildCloudImagePayload(base);
    expect(validatePayload(null)).toBeNull();
    expect(validatePayload({ ...payload, v: 2 })).toBeNull();
    expect(validatePayload({ ...payload, declaredOrigin: "alien" })).toBeNull();
    expect(validatePayload({ ...payload, contentHash: "sha256:XYZ" })).toBeNull();
    expect(validatePayload({ ...payload, byteLength: -1 })).toBeNull();
    expect(validatePayload({ ...payload, keyAlgorithm: "ml-dsa-65" })).toBeNull();
    expect(validatePayload({ ...payload, trust: { siteId: "x" } })).toBeNull();
    expect(validatePayload({ ...payload, trust: { siteId: "x", counts: { self: "1" }, projection: null, computedAt: "t" } })).toBeNull();
    expect(validatePayload({ ...payload, trust: { siteId: "default", counts: { self: 1, agent: 0, community: 0, escrowReports: 0 }, projection: { aggregates: {}, dimensions: {}, governed: "withheld" }, computedAt: "t" } })).not.toBeNull();
  });

  it("parseSidecar exige payload valido + jws con forma", async () => {
    const { sidecar } = await signedWorld();
    expect(parseSidecar(sidecar)).toEqual(sidecar);
    expect(parseSidecar({ payload: sidecar.payload })).toBeNull();
    expect(parseSidecar({ payload: { ...sidecar.payload, v: 9 }, jws: sidecar.jws })).toBeNull();
    expect(parseSidecar("junk")).toBeNull();
  });
});

describe("sign + verifyCloudImageSidecar", () => {
  it("round-trip valido: payload integro y key elegida por kid", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifyCloudImageSidecar(sidecar, [
      { keyId: `${SITE_DID}#key-1`, publicKeyJwk: keyPair.publicKeyJwk, source: "history" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(sidecar.payload);
      expect(result.header.typ).toBe(IMAGE_TYP);
      expect(result.header.kid).toBe(`${SITE_DID}#key-1`);
    }
  });

  it("key_not_found si ninguna clave candidata corresponde al kid", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const otra = await generateApwDid("otro.example");
    const result = await verifyCloudImageSidecar(sidecar, [
      { keyId: "did:apw:otro.example#key-1", publicKeyJwk: otra.publicKeyJwk },
    ]);
    expect(result).toEqual({ ok: false, reason: "key_not_found" });
    // y la clave correcta no se usa si el kid no matchea
    expect((await verifyCloudImageSidecar(sidecar, [{ publicKeyJwk: keyPair.publicKeyJwk }])).ok).toBe(false);
  });

  it("payload alterado post-firma -> payload_mismatch (el JCS del sidecar difiere)", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const tampered = { ...sidecar, payload: { ...sidecar.payload, declaredOrigin: "human" as const } };
    const result = await verifyCloudImageSidecar(tampered, [{ keyId: `${SITE_DID}#key-1`, publicKeyJwk: keyPair.publicKeyJwk }]);
    expect(result).toEqual({ ok: false, reason: "payload_mismatch" });
  });

  it("firma alterada -> bad_signature; typ distinto -> invalid_typ", async () => {
    const { key, sidecar } = await signedWorld();
    const publicLike = { kid: null, keyId: `${SITE_DID}#key-1`, publicKeyJwk: (await generateApwDid("ejemplo.com")).publicKeyJwk };

    const [h, p, s] = sidecar.jws.split(".");
    const badSig = `${h}.${p}.${s.slice(0, s.length - 2)}AA`;
    expect(await verifyCloudImageSidecar({ ...sidecar, jws: badSig }, [publicLike])).toEqual({ ok: false, reason: "bad_signature" });

    const otroTyp = await signSiteJws(sidecar.payload as unknown as Record<string, unknown>, key, "otra-cosa+jws");
    expect(await verifyCloudImageSidecar({ ...sidecar, jws: otroTyp }, [publicLike])).toEqual({ ok: false, reason: "invalid_typ" });
  });

  it("kid legacy = huella RFC 7638 matchea via jwkThumbprint", async () => {
    // Un JWS con header kid = huella (el formato de las entradas viejas del
    // historial, previas a E-3): se arma a mano porque signSiteJws exige
    // keyId con forma did:apw.
    const { keyPair, payload, sidecar } = await signedWorld();
    const thumb = await jwkThumbprint(keyPair.publicKeyJwk);
    const enc = new TextEncoder();
    const b64url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const header = { alg: "EdDSA", kid: thumb, typ: IMAGE_TYP };
    const signingInput = `${b64url(jcs(header))}.${b64url(jcs(payload as unknown as Record<string, unknown>))}`;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: keyPair.publicKeyJwk.x as string, d: keyPair.privateKeyJwk.d as string },
      { name: "Ed25519" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(signingInput));
    const legacyJws = `${signingInput}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;

    const result = await verifyCloudImageSidecar({ payload, jws: legacyJws }, [
      { keyId: null, kid: thumb, publicKeyJwk: keyPair.publicKeyJwk },
    ]);
    expect(result.ok).toBe(true);
    // y con keyId null + kid que no coincide, tampoco matchea
    expect((await verifyCloudImageSidecar({ payload, jws: sidecar.jws }, [{ keyId: null, kid: "otra", publicKeyJwk: keyPair.publicKeyJwk }])).ok).toBe(false);
  });

  it("sidecar con forma rota -> malformed_sidecar u header_invalid", async () => {
    const { sidecar } = await signedWorld();
    expect(await verifyCloudImageSidecar(null, [])).toEqual({ ok: false, reason: "malformed_sidecar" });
    expect(await verifyCloudImageSidecar({ payload: sidecar.payload }, [])).toEqual({ ok: false, reason: "malformed_sidecar" });
    expect(await verifyCloudImageSidecar({ payload: sidecar.payload, jws: "a.b" }, [])).toEqual({ ok: false, reason: "malformed_sidecar" });
    const garbageHeader = `bm90LWpzb24.${sidecar.jws.split(".")[1]}.x`;
    expect(await verifyCloudImageSidecar({ payload: sidecar.payload, jws: garbageHeader }, [])).toEqual({ ok: false, reason: "header_invalid" });
  });

  it("decodeJwsHeader y imageKidBelongsToDid", async () => {
    const { sidecar } = await signedWorld();
    expect(decodeJwsHeader(sidecar.jws)).toEqual({ alg: "EdDSA", kid: `${SITE_DID}#key-1`, typ: IMAGE_TYP });
    expect(decodeJwsHeader("nope")).toBeNull();
    expect(imageKidBelongsToDid(`${SITE_DID}#key-2`, SITE_DID)).toBe(true);
    expect(imageKidBelongsToDid("did:apw:otro.example#key-1", SITE_DID)).toBe(false);
    expect(imageKidBelongsToDid("basura", SITE_DID)).toBe(false);
  });
});
