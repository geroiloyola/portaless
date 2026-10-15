// Manifiesto de plugin firmado (Fase 11.2, ERRATA E-15): typ propio, verificado
// contra la identidad resuelta del publicador, y la firma cubre lo que el
// plugin PIDE (requestedCapabilities).
import { describe, it, expect } from "vitest";
import {
  PLUGIN_MANIFEST_TYP,
  buildPluginManifestPayload,
  signPluginManifest,
  verifyPluginManifest,
  isPluginManifestDocument,
} from "../../packages/apw-resolver/src/did-apw/plugin-manifest";
import { signSiteJws, MANIFEST_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws";

const PUBLISHER = "did:apw:pub.example";
const KID = "did:apw:pub.example#key-1";

const manifest = {
  name: "mi-plugin",
  version: "1.0.0",
  entry: "index.js",
  runtime: "javascript" as const,
  requestedCapabilities: [{ id: "content:read", reason: "lee las páginas del sitio" }],
};

async function ed25519() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
  };
}

describe("manifiesto de plugin firmado", () => {
  it("firma y verifica contra la identidad resuelta del publicador", async () => {
    const keys = await ed25519();
    const jws = await signPluginManifest({ publisher: PUBLISHER, manifest, iat: 1800000000 }, { keyId: KID, privateKeyJwk: keys.privateJwk });
    const res = await verifyPluginManifest(jws, { publicKeyJwk: keys.publicJwk, kid: KID, publisher: PUBLISHER });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.document.publisher).toBe(PUBLISHER);
      expect(res.document.manifest.requestedCapabilities).toEqual(manifest.requestedCapabilities);
    }
  });

  it("la firma cubre requestedCapabilities (van en el payload firmado)", () => {
    const payload = buildPluginManifestPayload({ publisher: PUBLISHER, manifest, iat: 1 });
    expect(payload.manifest.requestedCapabilities).toEqual(manifest.requestedCapabilities);
  });

  it("rechaza un publisher distinto del esperado", async () => {
    const keys = await ed25519();
    const jws = await signPluginManifest({ publisher: PUBLISHER, manifest, iat: 1 }, { keyId: KID, privateKeyJwk: keys.privateJwk });
    const res = await verifyPluginManifest(jws, { publicKeyJwk: keys.publicJwk, kid: KID, publisher: "did:apw:otro.example" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("publisher_mismatch");
  });

  it("rechaza otro typ (un manifiesto de sitio no es un manifiesto de plugin)", async () => {
    const keys = await ed25519();
    const wrong = await signSiteJws({ publisher: PUBLISHER, iat: 1, manifest } as never, { keyId: KID, privateKeyJwk: keys.privateJwk }, MANIFEST_TYP);
    const res = await verifyPluginManifest(wrong, { publicKeyJwk: keys.publicJwk, kid: KID, publisher: PUBLISHER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_typ");
    expect(PLUGIN_MANIFEST_TYP).toBe("apw-plugin-manifest+jws");
  });

  it("rechaza un documento mal formado", () => {
    expect(isPluginManifestDocument({ publisher: "did:apw:x.example", iat: 1, manifest: { name: "n" } })).toBe(false);
    expect(isPluginManifestDocument({ publisher: "https://x", iat: 1, manifest })).toBe(false);
    expect(isPluginManifestDocument({ publisher: PUBLISHER, iat: 1, manifest })).toBe(true);
  });

  it("no firma con la clave de otro publicador", async () => {
    const keys = await ed25519();
    await expect(
      signPluginManifest({ publisher: PUBLISHER, manifest, iat: 1 }, { keyId: "did:apw:otro.example#key-1", privateKeyJwk: keys.privateJwk })
    ).rejects.toThrow("key_id_not_for_publisher");
  });
});
