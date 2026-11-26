// tests/unit/apw-site-identity-store.test.ts
//
// Tests reales del SiteIdentityStore: usa InMemorySiteIdentityStore (sin
// D1/SQLite) pero con cifrado AES-GCM real via WebCrypto.

import { describe, it, expect, beforeAll } from "vitest";
import { InMemorySiteIdentityStore } from "@verared/apw/did-apw";
import { generateApwDid } from "@verared/apw/did-apw";

function randomEncryptionKeyBase64() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

describe("InMemorySiteIdentityStore", () => {
  let options: { encryptionKey: string };

  beforeAll(() => {
    options = { encryptionKey: randomEncryptionKeyBase64() };
  });

  it("devuelve null si el sitio no tiene identidad todavia", async () => {
    const store = new InMemorySiteIdentityStore(options);
    expect(await store.get("default")).toBeNull();
  });

  it("persiste una identidad y la recupera sin la clave privada", async () => {
    const store = new InMemorySiteIdentityStore(options);
    const keyPair = await generateApwDid("miportal.example.com");
    const record = await store.create("default", keyPair, "admin");

    expect(record.did).toBe("did:apw:miportal.example.com");
    expect(record.siteId).toBe("default");
    expect(record.createdBy).toBe("admin");
    expect((record as any).privateKeyJwk).toBeUndefined();

    const fetched = await store.get("default");
    expect(fetched?.did).toBe(keyPair.did);
    expect((fetched as any)?.privateKeyJwk).toBeUndefined();
  });

  it("cifra la clave privada -- getDecryptedPrivateKey la recupera correctamente", async () => {
    const store = new InMemorySiteIdentityStore(options);
    const keyPair = await generateApwDid("otro-sitio.example.com");
    await store.create("default", keyPair, "admin");
    const decrypted = await store.getDecryptedPrivateKey("default");
    expect(decrypted).toEqual(keyPair.privateKeyJwk);
  });

  it("getDecryptedPrivateKey devuelve null si no hay identidad", async () => {
    const store = new InMemorySiteIdentityStore(options);
    expect(await store.getDecryptedPrivateKey("default")).toBeNull();
  });

  it("cada store descifra correctamente con su propia clave de cifrado", async () => {
    const optsA = { encryptionKey: randomEncryptionKeyBase64() };
    const optsB = { encryptionKey: randomEncryptionKeyBase64() };
    const keyPair = await generateApwDid("sitio-fijo.example.com");

    const storeA = new InMemorySiteIdentityStore(optsA);
    const storeB = new InMemorySiteIdentityStore(optsB);
    await storeA.create("default", keyPair, "admin");
    await storeB.create("default", keyPair, "admin");

    expect(await storeA.getDecryptedPrivateKey("default")).toEqual(keyPair.privateKeyJwk);
    expect(await storeB.getDecryptedPrivateKey("default")).toEqual(keyPair.privateKeyJwk);
  });

  it("lanza un error claro si falta la clave de cifrado", async () => {
    const store = new InMemorySiteIdentityStore({});
    const keyPair = await generateApwDid("sin-env.example.com");
    await expect(store.create("default", keyPair, "admin")).rejects.toThrow(/encryptionKey/i);
  });
});
