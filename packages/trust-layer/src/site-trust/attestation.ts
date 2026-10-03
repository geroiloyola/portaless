// packages/trust-layer/src/site-trust/attestation.ts
//
// Atestaciones firmadas por el emisor (APW v1.2, seccion 5.3; ERRATA E-4).
// Una atestacion es un JWS compacto que firma QUIEN GENERA el dato (agente o
// proveedor de escrow), nunca el sitio evaluado. Payload:
//   { typ: "apw-attestation+jws", iss, sub: "did:apw:<dominio>", src, cat, val, iat, jti }
//
// Aca solo se VERIFICA: los bytes del JWS se validan tal como llegan, sin
// canonicalizar nada (la canonicalizacion es problema del emisor). Por eso
// este modulo no necesita JCS.
//
// Solo EdDSA sobre Ed25519 (kty OKP). Una clave ML-DSA del directorio de un
// agente se rechaza con unsupported_key: la seccion 5.3 pide la misma clave
// Ed25519 que el agente publica en su directorio Web Bot Auth.
//
// ERRATA E-9: skipIatWindow omite el chequeo de +-300 s sobre iat. Solo para
// atestaciones leidas del historial publicado de un tercero: alli la ventana no
// aplica (pueden tener meses) y el ts firmado de la cadena prueba cuando se
// anotaron. Al RECIBIR una atestacion (endpoints) la ventana sigue vigente.

export const ATTESTATION_TYP = "apw-attestation+jws";
/** Margen aceptado para iat, en segundos, hacia atras y hacia adelante. */
export const ATTESTATION_IAT_WINDOW_SECONDS = 300;
const MAX_JWS_LENGTH = 8192;
const COMPACT_JWS_RE = /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/;
const JTI_RE = /^[\x21-\x7e]{1,128}$/;

export type AttestationSource = "agent" | "escrow_report" | "self" | "reader_conduct";

export interface AttestationClaims {
  typ: string;
  iss: string;
  sub: string;
  src: AttestationSource;
  cat: string;
  val: boolean;
  iat: number;
  jti: string;
}

export type AttestationFailure =
  | "malformed_attestation"
  | "unsupported_alg"
  | "invalid_typ"
  | "kid_mismatch"
  | "unsupported_key"
  | "bad_signature"
  | "invalid_claims"
  | "sub_mismatch"
  | "src_mismatch"
  | "iss_mismatch"
  | "iat_out_of_window";

export interface AttestationExpectations {
  sub: string;
  src: AttestationSource;
  iss: string;
  /** Si se indica, el header del JWS debe traer exactamente este kid. */
  kid?: string;
  /** E-9: solo para atestaciones leidas de un historial publicado. */
  skipIatWindow?: boolean;
}

export type VerifyAttestationResult =
  | { ok: true; claims: AttestationClaims }
  | { ok: false; reason: AttestationFailure };

function b64UrlToBytes(text: string): Uint8Array {
  const base64 = text.split("-").join("+").split("_").join("/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64UrlToBytes(part)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** URLs https se comparan por origen; cualquier otro identificador, por igualdad exacta. */
export function sameIssuer(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    return a.protocol === "https:" && b.protocol === "https:" && a.origin === b.origin;
  } catch {
    return false;
  }
}

function validClaims(payload: Record<string, unknown>): payload is Record<string, unknown> & AttestationClaims {
  return (
    typeof payload.iss === "string" &&
    payload.iss.length > 0 &&
    typeof payload.sub === "string" &&
    typeof payload.src === "string" &&
    typeof payload.cat === "string" &&
    payload.cat.length > 0 &&
    payload.cat.length <= 64 &&
    typeof payload.val === "boolean" &&
    Number.isSafeInteger(payload.iat) &&
    typeof payload.jti === "string" &&
    JTI_RE.test(payload.jti)
  );
}

/** Verifica una atestacion contra la clave publica del emisor. Nunca lanza. */
export async function verifyAttestation(
  jws: unknown,
  publicKeyJwk: JsonWebKey | null | undefined,
  expected: AttestationExpectations,
  nowMs: number = Date.now()
): Promise<VerifyAttestationResult> {
  const fail = (reason: AttestationFailure): VerifyAttestationResult => ({ ok: false, reason });

  if (typeof jws !== "string" || jws.length > MAX_JWS_LENGTH || !COMPACT_JWS_RE.test(jws)) return fail("malformed_attestation");
  const [headerPart, payloadPart, signaturePart] = jws.split(".");

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeJson(headerPart);
    payload = decodeJson(payloadPart);
  } catch {
    return fail("malformed_attestation");
  }
  if (!isObject(header) || !isObject(payload)) return fail("malformed_attestation");

  if (header.alg !== "EdDSA") return fail("unsupported_alg");
  if (header.typ !== undefined && header.typ !== ATTESTATION_TYP) return fail("invalid_typ");
  if (payload.typ !== ATTESTATION_TYP) return fail("invalid_typ");
  if (expected.kid !== undefined && header.kid !== expected.kid) return fail("kid_mismatch");

  if (!publicKeyJwk || publicKeyJwk.kty !== "OKP" || publicKeyJwk.crv !== "Ed25519" || typeof publicKeyJwk.x !== "string") {
    return fail("unsupported_key");
  }

  let signatureOk = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: publicKeyJwk.x } as JsonWebKey,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    signatureOk = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      b64UrlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return fail("bad_signature");

  if (!validClaims(payload)) return fail("invalid_claims");
  if (payload.sub !== expected.sub) return fail("sub_mismatch");
  if (payload.src !== expected.src) return fail("src_mismatch");
  if (!sameIssuer(payload.iss, expected.iss)) return fail("iss_mismatch");
  if (!expected.skipIatWindow && Math.abs(nowMs / 1000 - payload.iat) > ATTESTATION_IAT_WINDOW_SECONDS) {
    return fail("iat_out_of_window");
  }

  return {
    ok: true,
    claims: {
      typ: payload.typ as string,
      iss: payload.iss,
      sub: payload.sub,
      src: payload.src as AttestationSource,
      cat: payload.cat,
      val: payload.val,
      iat: payload.iat,
      jti: payload.jti,
    },
  };
}
