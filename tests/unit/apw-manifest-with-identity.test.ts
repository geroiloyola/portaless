// buildApwManifestWithIdentity / extractDidDocumentFromManifest — la
// composicion aditiva que mete el didDocument en el payload del TXT sin
// tocar manifest.ts (0% de cobertura). Cubre: composicion no mutante,
// preservacion de campos base, y la defensa extract con shapes hostiles.

import { describe, it, expect } from "vitest";
import {
  buildApwManifestWithIdentity,
  extractDidDocumentFromManifest,
} from "../../packages/apw-resolver/src/manifest-with-identity";
import type { ApwDidDocument } from "../../packages/apw-resolver/src/did-apw/types";

const didDoc = { "@context": "https://www.w3.org/ns/did/v1", id: "did:apw:site-1" } as unknown as ApwDidDocument;

describe("buildApwManifestWithIdentity", () => {
  it("compone didDocument sin mutar el manifest base", () => {
    const base = { version: "1.0", signatory: "did:apw:site-1" };
    const composed = buildApwManifestWithIdentity(base, didDoc);
    expect(composed.version).toBe("1.0");
    expect(composed.didDocument).toBe(didDoc);
    expect((base as Record<string, unknown>).didDocument).toBeUndefined();
  });

  it("un didDocument existente se sobreescribe (el ultimo gana)", () => {
    const otra = { id: "did:apw:otro" } as unknown as ApwDidDocument;
    const composed = buildApwManifestWithIdentity({ didDocument: didDoc }, otra);
    expect(composed.didDocument).toBe(otra);
  });
});

describe("extractDidDocumentFromManifest", () => {
  it("devuelve el didDocument cuando el manifest es un objeto con el campo", () => {
    expect(extractDidDocumentFromManifest({ didDocument: didDoc })).toBe(didDoc);
  });

  it("defensa: null, undefined, primitivos y objetos sin campo devuelven null", () => {
    expect(extractDidDocumentFromManifest(null)).toBeNull();
    expect(extractDidDocumentFromManifest(undefined)).toBeNull();
    expect(extractDidDocumentFromManifest("string")).toBeNull();
    expect(extractDidDocumentFromManifest(42)).toBeNull();
    expect(extractDidDocumentFromManifest({})).toBeNull();
    // didDocument falsy explicito tambien cuenta como ausente.
    expect(extractDidDocumentFromManifest({ didDocument: null })).toBeNull();
    expect(extractDidDocumentFromManifest({ didDocument: 0 })).toBeNull();
  });
});
