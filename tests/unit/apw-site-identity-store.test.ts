// tests/unit/apw-site-identity-store.test.ts
//
// Tests reales del SiteIdentityStore: usa InMemorySiteIdentityStore (sin
// D1/SQLite) pero con cifrado AES-GCM real via WebCrypto.

import { describe, it, expect, beforeAll } from "vitest";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";

function randomEncryptionKeyBase64() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

describe("InMemorySiteIdentityStore", () => {
  let env;

  beforeAll(() => {
    env = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: randomEncryptionKeyBase64() };
  });

  it("devuelve null si el sitio no tiene identidad todavia", async () => {
    const store = new InMemorySiteIdentityStore(env);
    expect(await store.get("default")).toBeNull();
  });

  it("persiste una identidad y la recupera sin la clave privada", async () => {
    const store = new InMemorySiteIdentityStore(env);
    const keyPair = await generateApwDid("miportal.example.com");
    const record = await store.create("default", keyPair, "admin");

    expect(record.did).toBe("did:apw:miportal.example.com");
    expect(record.siteId).toBe("default");
    expect(record.createdBy).toBe("admin");
    expect(record.privateKeyJwk).toBeUndefined();

    const fetched = await store.get("default");
    expect(fetched?.did).toBe(keyPair.did);
    expect(fetched?.privateKeyJwk).toBeUndefined();
  });

  it("cifra la clave privada -- getDecryptedPrivateKey la recupera correctamente", async () => {
    const store = new InMemorySiteIdentityStore(env);
    const keyPair = await generateApwDid("otro-sitio.example.com");
    await store.create("default", keyPair, "admin");
    const decrypted = await store.getDecryptedPrivateKey("default");
    expect(decrypted).toEqual(keyPair.privateKeyJwk);
  });

  it("getDecryptedPrivateKey devuelve null si no hay identidad", async () => {
    const store = new InMemorySiteIdentityStore(env);
    expect(await store.getDecryptedPrivateKey("default")).toBeNull();
  });

  it("cada store descifra correctamente con su propia clave de cifrado", async () => {
    const envA = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: randomEncryptionKeyBase64() };
    const envB = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: randomEncryptionKeyBase64() };
    const keyPair = await generateApwDid("sitio-fijo.example.com");

    const storeA = new InMemorySiteIdentityStore(envA);
    const storeB = new InMemorySiteIdentityStore(envB);
    await storeA.create("default", keyPair, "admin");
    await storeB.create("default", keyPair, "admin");

    expect(await storeA.getDecryptedPrivateKey("default")).toEqual(keyPair.privateKeyJwk);
    expect(await storeB.getDecryptedPrivateKey("default")).toEqual(keyPair.privateKeyJwk);
  });

  it("lanza un error claro si falta la variable de entorno de cifrado", async () => {
    const store = new InMemorySiteIdentityStore({});
    const keyPair = await generateApwDid("sin-env.example.com");
    await expect(store.create("default", keyPair, "admin")).rejects.toThrow(/PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY/);
  });
});
