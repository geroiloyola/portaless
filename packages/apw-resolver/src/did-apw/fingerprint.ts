// packages/apw-resolver/src/did-apw/fingerprint.ts
//
// Huella de una clave publica para Protocol APW (campo `k` del manifiesto,
// APW v1.2 seccion 5.1 + ERRATA E-1): JWK Thumbprint de RFC 7638, en
// base64url sin padding.
//
// Se usan solo los miembros obligatorios de la clave, en orden
// lexicografico, sin espacios. Para Ed25519 (kty OKP) son crv, kty y x
// (RFC 8037, seccion 2). Los campos opcionales que agrega WebCrypto al
// exportar (key_ops, ext, alg, kid) no participan: dos implementaciones
// distintas calculan la misma huella para la misma clave.
//
// Es el mismo calculo que usa la libreria web-bot-auth para el `keyid`, asi
// que la huella APW de un agente coincide con su keyid de Web Bot Auth
// (APW v1.2, seccion 6.3).

const REQUIRED_MEMBERS: Record<string, string[]> = {
  OKP: ["crv", "kty", "x"],
  EC: ["crv", "kty", "x", "y"],
  RSA: ["e", "kty", "n"],
};

export const THUMBPRINT_RE = /^[A-Za-z0-9_-]{43}$/;

function requiredMembers(jwk: JsonWebKey): string[] {
  const members = typeof jwk?.kty === "string" ? REQUIRED_MEMBERS[jwk.kty] : undefined;
  if (!members) throw new Error("unsupported_key_type");
  for (const m of members) {
    if (typeof (jwk as Record<string, unknown>)[m] !== "string" || !(jwk as Record<string, string>)[m]) {
      throw new Error(`missing_jwk_member:${m}`);
    }
  }
  return members;
}

/** Copia de la clave publica con solo sus miembros obligatorios (nunca `d`). */
export function publicJwkMembers(jwk: JsonWebKey): JsonWebKey {
  const members = requiredMembers(jwk);
  const out: Record<string, string> = {};
  for (const m of members) out[m] = (jwk as Record<string, string>)[m];
  return out as JsonWebKey;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** JWK Thumbprint (RFC 7638) con SHA-256, en base64url. Lanza si la clave no es valida. */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const members = requiredMembers(jwk);
  const canonical =
    "{" + members.map((m) => `${JSON.stringify(m)}:${JSON.stringify((jwk as Record<string, string>)[m])}`).join(",") + "}";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64Url(new Uint8Array(digest));
}
