import { describe, expect, it } from "vitest";
import { buildSiteManifest } from "../../packages/apw-resolver/src/did-apw/site-manifest.ts";
import { signSiteManifest, verifySiteJws, MANIFEST_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws.ts";
import { serializeApwManifest, parseApwManifest } from "../../packages/apw-resolver/src/manifest.ts";

const DOMAIN = "ejemplo.com";
const DID = `did:apw:${DOMAIN}`;
const KID = `${DID}#key-1`;
const K = "k".repeat(43);
const H = "h".repeat(43);

describe("buildSiteManifest", () => {
  it("sin identidad: v1, sin k ni h", () => {
    const m = buildSiteManifest(DOMAIN, null, H);
    expect(m).toEqual({ v: 1, siteId: DOMAIN, trustUrl: `/trust/${DOMAIN}`, contentKinds: ["mixed"] });
  });
  it("con k y h: v2", () => {
    expect(buildSiteManifest(DOMAIN, K, H)).toMatchObject({ v: 2, k: K, h: H });
  });
  it("h solo viaja junto con k", () => {
    expect(buildSiteManifest(DOMAIN, null, H)).not.toHaveProperty("h");
  });
  it("el TXT serializado vuelve a parsear como el mismo manifiesto", () => {
    const m = buildSiteManifest(DOMAIN, K, H);
    expect(parseApwManifest(serializeApwManifest(m))).toEqual({ valid: true, manifest: m });
  });
});

describe("manifiesto firmado = TXT + did + iat", () => {
  it("el payload firmado repite exactamente los campos del TXT", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
    const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;

    const txt = buildSiteManifest(DOMAIN, K, H);
    const jws = await signSiteManifest(txt as unknown as Record<string, unknown>, DID, { keyId: KID, privateKeyJwk: priv }, 1790000000);
    const r = await verifySiteJws(jws, pub, { kid: KID, typ: MANIFEST_TYP });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { did, iat, ...rest } = r.payload;
    expect(did).toBe(DID);
    expect(iat).toBe(1790000000);
    expect(rest).toEqual(txt);
  });
});
