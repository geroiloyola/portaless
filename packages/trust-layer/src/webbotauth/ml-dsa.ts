// ML-DSA (FIPS 204, post-cuantico) compartido por los DOS verificadores
// de Web Bot Auth (v0.0.9.31):
//   - webbotauth/verify.ts: control de acceso del middleware (antes
//     Ed25519-only; ahora acepta ML-DSA-44/65/87 ademas).
//   - site-trust/web-bot-auth.ts: fuente "agent" de SiteTrustScore
//     (lo tenia desde v0.0.9.30; ahora reexporta desde aqui para que no
//     existan dos implementaciones de la misma criptografia).
//
// @noble/post-quantum se carga con import() perezoso: el camino
// Ed25519 del middleware (el comun) no paga ni el parseo del modulo PQ.
// Si la libreria no esta instalada, verifyMlDsaSignature lanza
// MlDsaUnavailableError (fail-closed explicito) y createMlDsaVerifier
// lo convierte en false, como cualquier firma invalida.
//
// Orden de argumentos en @noble/post-quantum 0.5.x: sign(mensaje,
// claveSecreta) y verify(firma, mensaje, clavePublica). Con el orden
// equivocado verify() LANZA y un catch silencioso rechazaria TODAS las
// firmas sin error visible -- ver ROADMAP/CHANGELOG del PR #54.
//
// Advertencias honestas (las mismas que site-trust/web-bot-auth.ts):
// - @noble/post-quantum no tiene todavia una auditoria independiente.
// - Solo se VERIFICAN firmas con claves publicas; el riesgo de canal
//   lateral es acotado.
// - El formato JWK `kty: "AKP"` sale de un borrador IETF y puede cambiar.

import { base64UrlToBytes } from "./rfc9421";

export class MlDsaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MlDsaUnavailableError";
  }
}

/** Valores de alg en JWKs/directorios (FIPS 204, mayusculas). */
export const ML_DSA_JWK_ALGS = ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"] as const;
export type MlDsaJwkAlg = (typeof ML_DSA_JWK_ALGS)[number];

/** Forma minima de un JWK/directorio que puede portar una clave ML-DSA. */
export interface MlDsaCapableJwk {
  kty: string;
  crv?: string;
  kid?: string;
  x?: string;
  alg?: string;
  /** ML-DSA (kty "AKP"): clave publica en base64url. */
  pub?: string;
}

export function isMlDsaJwk(jwk: { kty?: string; alg?: string }): boolean {
  return jwk.kty === "AKP" && typeof jwk.alg === "string" && (ML_DSA_JWK_ALGS as readonly string[]).includes(jwk.alg);
}

/** Mapea un JWK al valor que usa authorized_agents.key_algorithm (minusculas). */
export function jwkKeyAlgorithm(jwk: MlDsaCapableJwk): string {
  if (isMlDsaJwk(jwk)) return (jwk.alg as string).toLowerCase();
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "ed25519";
  return "unknown";
}

/**
 * Normaliza el parametro `alg` de Signature-Input (tokens de headers,
 * case-insensitive en la practica) a minusculas, o null si no es uno de
 * los algoritmos soportados. draft-03 deja alg opcional: la ausencia es
 * valida y quien manda es el tipo de clave del directorio.
 */
export function normalizeAlgParam(value: string | undefined | null): string | null {
  if (typeof value !== "string" || !value) return null;
  const lowered = value.toLowerCase();
  if (lowered === "ed25519") return lowered;
  if ((["ml-dsa-44", "ml-dsa-65", "ml-dsa-87"] as string[]).includes(lowered)) return lowered;
  return null;
}

interface MlDsaImpl {
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
}

let implsPromise: Promise<Record<MlDsaJwkAlg, MlDsaImpl>> | null = null;

async function loadImpls(): Promise<Record<MlDsaJwkAlg, MlDsaImpl>> {
  if (!implsPromise) {
    implsPromise = import("@noble/post-quantum/ml-dsa.js").then((m) => ({
      "ML-DSA-44": m.ml_dsa44,
      "ML-DSA-65": m.ml_dsa65,
      "ML-DSA-87": m.ml_dsa87,
    }));
  }
  return implsPromise;
}

/** Solo para tests: olvida el cache de la libreria cargada. */
export function __resetMlDsaImplCacheForTests(): void {
  implsPromise = null;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/**
 * Verifica una firma ML-DSA sobre `message` (el signature base RFC 9421,
 * u otro bytes). `algJwk` es el valor FIPS del JWK ("ML-DSA-65").
 * Devuelve false para firmas invalidas; LANZA MlDsaUnavailableError si
 * la libreria PQ no se pudo cargar (fail-closed explicito).
 */
export async function verifyMlDsaSignature(
  algJwk: MlDsaJwkAlg,
  message: string | Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  let impls: Record<MlDsaJwkAlg, MlDsaImpl>;
  try {
    impls = await loadImpls();
  } catch (err) {
    throw new MlDsaUnavailableError(
      `@noble/post-quantum no se pudo cargar para verificar ${algJwk}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    // @noble/post-quantum 0.5.x: verify(firma, mensaje, clavePublica).
    return impls[algJwk].verify(signature, toBytes(message), publicKey);
  } catch {
    return false;
  }
}

/**
 * Construye un verificador ML-DSA compatible con verify() de web-bot-auth
 * (la forma que consume la fuente "agent" de SiteTrustScore). Es a la vez
 * una funcion (data, signature) que LANZA si la firma es invalida
 * (web-bot-auth 0.1.x) y un objeto { algorithm, keyid, verify } que
 * devuelve boolean (versiones posteriores).
 */
export function createMlDsaVerifier(jwk: MlDsaCapableJwk) {
  if (!isMlDsaJwk(jwk)) throw new Error("unsupported_pq_algorithm");
  if (!jwk.pub) throw new Error("missing_ml_dsa_public_key");
  const algJwk = jwk.alg as MlDsaJwkAlg;
  const publicKey = base64UrlToBytes(jwk.pub);

  const check = async (data: string | Uint8Array, signature: Uint8Array): Promise<boolean> => {
    try {
      return await verifyMlDsaSignature(algJwk, data, signature, publicKey);
    } catch {
      return false;
    }
  };

  const fn = async (data: string | Uint8Array, signature: Uint8Array): Promise<void> => {
    if (!(await check(data, signature))) throw new Error("invalid_ml_dsa_signature");
  };

  return Object.assign(fn, {
    algorithm: (jwk.alg as string).toLowerCase(),
    keyid: jwk.kid ?? "",
    verify: check,
  });
}
