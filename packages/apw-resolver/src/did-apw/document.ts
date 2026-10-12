// packages/apw-resolver/src/did-apw/document.ts
//
// Construccion del documento DID W3C-compatible para did:apw. Shape
// deliberadamente igual al de un documento did:web estandar
// (@context + id + verificationMethod + assertionMethod) -- cualquier
// libreria de resolucion de DID generica (incluidas las que usa VeraDID,
// ver VeraDID_2_Technical_Architecture) puede leer este documento sin
// necesitar codigo especifico para did:apw, salvo la resolucion del
// identificador en si (que en did:apw es via DNS TXT, no via un
// registro PLC federado como did:plc).

import type { ApwDidDocument, ApwVerificationMethod } from "./types";

export interface BuildDidDocumentOptions {
  /**
   * Puente opcional con AT Protocol: handles `at://<handle>` que el
   * sitio reclama (tabla site_atproto_links). El campo es el mismo
   * `alsoKnownAs` W3C que lee el ecosistema AT -- un documento sin
   * vinculos sale EXACTAMENTE igual que antes (retrocompatible).
   */
  alsoKnownAs?: readonly string[];
}

export function buildDidDocument(did: string, publicKeyJwk: JsonWebKey, options: BuildDidDocumentOptions = {}): ApwDidDocument {
  const keyId = `${did}#key-1`;

  const verificationMethod: ApwVerificationMethod = {
    id: keyId,
    type: "Ed25519VerificationKey2020",
    controller: did,
    publicKeyJwk,
  };

  const alsoKnownAs = options.alsoKnownAs?.filter((uri) => typeof uri === "string" && uri.length > 0) ?? [];

  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [verificationMethod],
    assertionMethod: [keyId],
    ...(alsoKnownAs.length > 0 ? { alsoKnownAs: [...alsoKnownAs] } : {}),
  };
}

/**
 * Valida que un objeto recibido (ej. desde un TXT record resuelto)
 * tiene la forma minima esperada de un ApwDidDocument, sin lanzar
 * excepciones -- mismo principio defensivo que parseApwManifest() en
 * manifest.ts (contenido invalido = null, nunca throw).
 */
export function parseApwDidDocument(value: unknown): ApwDidDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== "string" || !candidate.id.startsWith("did:apw:")) {
    return null;
  }
  if (!Array.isArray(candidate.verificationMethod) || candidate.verificationMethod.length === 0) {
    return null;
  }
  const firstMethod = candidate.verificationMethod[0] as Record<string, unknown>;
  if (
    typeof firstMethod?.id !== "string" ||
    typeof firstMethod?.controller !== "string" ||
    !firstMethod?.publicKeyJwk
  ) {
    return null;
  }

  // alsoKnownAs es opcional, pero si esta tiene que ser string[] puro
  // (un shape corrupto invalida el documento entero, no solo el campo).
  if (candidate.alsoKnownAs !== undefined) {
    if (!Array.isArray(candidate.alsoKnownAs) || candidate.alsoKnownAs.some((entry) => typeof entry !== "string")) {
      return null;
    }
  }

  return candidate as unknown as ApwDidDocument;
}
