import { describe, expect, it } from "vitest";
import {
  jcs, signSiteJws, verifySiteJws, signSelfAttestation, signSiteManifest, ATTESTATION_TYP, MANIFEST_TYP,
} from "../../packages/apw-resolver/src/did-apw/site-jws.ts";
import { verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation.ts";
import { buildApwManifest } from "../../packages/apw-resolver/src/manifest.ts";

const DID = "did:apw:ejemplo.com";
const KID = `${DID}#key-1`;

function b64UrlDecodeText(part: string): string {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

async function keyPair() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  return { priv, pub };
}

describe("JCS (RFC 8785)", () => {
  it("ordena claves y es estable", () => {
    expect(jcs({ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}');
  });
  it("numeros segun ES6: -0 -> 0, exponentes", () => {
    expect(jcs({ n: -0 })).toBe('{"n":0}');
    expect(jcs([1e21, 1.5, 100])).toBe("[1e+21,1.5,100]");
  });
  it("unicode sin escapar", () => {
    expect(jcs({ s: "\u00f1\u20ac" })).toBe('{"s":"\u00f1\u20ac"}');
  });
  it("rechaza valores no I-JSON", () => {
    expect(() => jcs({ a: undefined })).toThrow(/not_i_json/);
    expect(() => jcs({ a: NaN })).toThrow(/not_i_json/);
    expect(() => jcs({ a: Infinity })).toThrow(/not_i_json/);
    expect(() => jcs({ a: () => 1 })).toThrow(/not_i_json/);
    expect(() => jcs({ a: 1n })).toThrow(/not_i_json/);
    expect(() => jcs({ a: new Date(0) })).toThrow(/not_i_json/);
  });
});

describe("JWS del sitio", () => {
  it("firma y verifica; el payload viaja en forma JCS", async () => {
    const { priv, pub } = await keyPair();
    const jws = await signSiteJws({ z: 1, a: "x" }, { keyId: KID, privateKeyJwk: priv }, MANIFEST_TYP);
    expect(b64UrlDecodeText(jws.split(".")[1])).toBe('{"a":"x","z":1}');
    expect(b64UrlDecodeText(jws.split(".")[0])).toBe(`{"alg":"EdDSA","kid":"${KID}","typ":"${MANIFEST_TYP}"}`);
    const r = await verifySiteJws(jws, pub, { kid: KID, typ: MANIFEST_TYP });
    expect(r.ok).toBe(true);
  });
  it("rechaza firma alterada, kid ajeno, typ ajeno y clave de otra rotacion", async () => {
    const { priv, pub } = await keyPair();
    const other = await keyPair();
    const jws = await signSiteJws({ a: 1 }, { keyId: KID, privateKeyJwk: priv }, MANIFEST_TYP);
    const [h, p, s] = jws.split(".");
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`;
    expect(await verifySiteJws(tampered, pub, { kid: KID, typ: MANIFEST_TYP })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(await verifySiteJws(jws, pub, { kid: `${DID}#key-2`, typ: MANIFEST_TYP })).toMatchObject({ ok: false, reason: "kid_mismatch" });
    expect(await verifySiteJws(jws, pub, { kid: KID, typ: ATTESTATION_TYP })).toMatchObject({ ok: false, reason: "invalid_typ" });
    expect(await verifySiteJws(jws, other.pub, { kid: KID, typ: MANIFEST_TYP })).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("rechaza kid que no es did:apw#key-n", async () => {
    const { priv } = await keyPair();
    await expect(signSiteJws({ a: 1 }, { keyId: "abc", privateKeyJwk: priv }, MANIFEST_TYP)).rejects.toThrow("invalid_key_id");
  });
});

describe("atestacion self (B3)", () => {
  it("verifica con el mismo verifyAttestation que agent/escrow_report", async () => {
    const { priv, pub } = await keyPair();
    const { jws, jti } = await signSelfAttestation(
      { did: DID, category: "privacy_policy", value: true },
      { keyId: KID, privateKeyJwk: priv }
    );
    const r = await verifyAttestation(jws, pub, { sub: DID, src: "self", iss: DID, kid: KID });
    expect(r).toMatchObject({ ok: true, claims: { src: "self", cat: "privacy_policy", val: true, jti } });
  });
  it("no firma con una clave de otro DID", async () => {
    const { priv } = await keyPair();
    await expect(
      signSelfAttestation({ did: DID, category: "privacy_policy", value: true }, { keyId: "did:apw:otro.com#key-1", privateKeyJwk: priv })
    ).rejects.toThrow("key_id_not_for_did");
  });
});

describe("manifiesto firmado", () => {
  it("firma el manifiesto v2 con did e iat", async () => {
    const { priv, pub } = await keyPair();
    const manifest = buildApwManifest({ siteId: "default", contentKinds: ["text"], k: "a".repeat(43), rg: true });
    const jws = await signSiteManifest(manifest as unknown as Record<string, unknown>, DID, { keyId: KID, privateKeyJwk: priv }, 1790000000);
    const r = await verifySiteJws(jws, pub, { kid: KID, typ: MANIFEST_TYP });
    expect(r.ok && r.payload).toMatchObject({ v: 2, siteId: "default", k: "a".repeat(43), rg: true, did: DID, iat: 1790000000 });
  });
});
