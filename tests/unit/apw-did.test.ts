// tests/unit/apw-did.test.ts
//
// Tests reales del modulo did-apw: usa WebCrypto real para generar
// pares de claves (sin mocks, mismo estandar que
// tests/unit/webbotauth-verify.test.ts) y valida que el documento DID
// resultante tiene el shape esperado por parseApwDidDocument().

import { describe, it, expect } from "vitest";
import { generateApwDid, buildDidDocument, parseApwDidDocument } from "../../packages/apw-resolver/src/did-apw";

describe("generateApwDid", () => {
  it("genera un did:apw valido con claves Ed25519 reales", async () => {
    const result = await generateApwDid("miportal.example.com");

    expect(result.did).toBe("did:apw:miportal.example.com");
    expect(result.domain).toBe("miportal.example.com");
    expect(result.publicKeyJwk.kty).toBe("OKP");
    expect(result.publicKeyJwk.crv).toBe("Ed25519");
    expect(result.privateKeyJwk.kty).toBe("OKP");
    expect(result.privateKeyJwk.d).toBeDefined();
    expect(result.publicKeyJwk.d).toBeUndefined();
  });

  it("normaliza el dominio a minusculas", async () => {
    const result = await generateApwDid("MiPortal.Example.COM");
    expect(result.did).toBe("did:apw:miportal.example.com");
  });

  it("genera pares de claves distintos en invocaciones distintas", async () => {
    const a = await generateApwDid("sitio-a.example.com");
    const b = await generateApwDid("sitio-a.example.com");
    expect(a.privateKeyJwk.d).not.toBe(b.privateKeyJwk.d);
  });

  it("rechaza un dominio vacio", async () => {
    await expect(generateApwDid("")).rejects.toThrow();
  });

  it("incluye un didDocument con el shape correcto", async () => {
    const result = await generateApwDid("miportal.example.com");

    expect(result.didDocument.id).toBe("did:apw:miportal.example.com");
    expect(result.didDocument["@context"]).toContain("https://www.w3.org/ns/did/v1");
    expect(result.didDocument.verificationMethod).toHaveLength(1);
    expect(result.didDocument.verificationMethod[0].id).toBe("did:apw:miportal.example.com#key-1");
    expect(result.didDocument.verificationMethod[0].controller).toBe("did:apw:miportal.example.com");
    expect(result.didDocument.assertionMethod).toEqual(["did:apw:miportal.example.com#key-1"]);
  });
});

describe("buildDidDocument", () => {
  it("construye un documento reproducible a partir de did + clave publica", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const doc = buildDidDocument("did:apw:otro-sitio.com", publicKeyJwk);

    expect(doc.id).toBe("did:apw:otro-sitio.com");
    expect(doc.verificationMethod[0].type).toBe("Ed25519VerificationKey2020");
    expect(doc.verificationMethod[0].publicKeyJwk).toEqual(publicKeyJwk);
  });
});

describe("parseApwDidDocument", () => {
  it("acepta un documento bien formado", async () => {
    const result = await generateApwDid("valido.example.com");
    const parsed = parseApwDidDocument(result.didDocument);

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("did:apw:valido.example.com");
  });

  it("rechaza valores que no son objetos", () => {
    expect(parseApwDidDocument(null)).toBeNull();
    expect(parseApwDidDocument("did:apw:x.com")).toBeNull();
    expect(parseApwDidDocument(42)).toBeNull();
  });

  it("rechaza un id que no empieza con did:apw:", () => {
    expect(parseApwDidDocument({ id: "did:web:x.com", verificationMethod: [{ id: "a", controller: "b", publicKeyJwk: {} }] })).toBeNull();
  });

  it("rechaza un documento sin verificationMethod", () => {
    expect(parseApwDidDocument({ id: "did:apw:x.com", verificationMethod: [] })).toBeNull();
  });

  it("rechaza un verificationMethod incompleto", () => {
    expect(
      parseApwDidDocument({
        id: "did:apw:x.com",
        verificationMethod: [{ id: "did:apw:x.com#key-1" }],
      })
    ).toBeNull();
  });
});
