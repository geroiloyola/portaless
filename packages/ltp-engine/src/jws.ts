import { createPublicKey, verify as verifySignature } from "node:crypto";
import { base64urlToBytes, canonicalBytes, digestBytes, utf8Bytes, utf8Text } from "./canonical";

export interface ParsedJws {
  compact: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadBytes: Uint8Array;
  signingInput: Uint8Array;
  signature: Uint8Array;
}

export function parseCompactJws(compact: string): ParsedJws | null {
  const parts = compact.split(".");
  if (parts.length !== 3 || parts.some(part => part.length === 0)) return null;
  try {
    const header = JSON.parse(utf8Text(base64urlToBytes(parts[0])));
    const payloadBytes = base64urlToBytes(parts[1]);
    const payload = JSON.parse(utf8Text(payloadBytes));
    if (!header || typeof header !== "object" || Array.isArray(header)) return null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return {
      compact,
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      payloadBytes,
      signingInput: utf8Bytes(`${parts[0]}.${parts[1]}`),
      signature: base64urlToBytes(parts[2]),
    };
  } catch {
    return null;
  }
}

export function verifyEd25519(jwk: JsonWebKey, jws: ParsedJws): boolean {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") return false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verifySignature(null, jws.signingInput, key, jws.signature);
  } catch {
    return false;
  }
}

/** RFC 7638 JWK thumbprint over the mandatory Ed25519 members only. */
export function jwkThumbprint(jwk: JsonWebKey): string | null {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") return null;
  return digestBytes(canonicalBytes({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }));
}

export function jwsDigest(compact: string): string {
  return digestBytes(utf8Bytes(compact));
}
