// Verificacion de identidad de agentes via Web Bot Auth (RFC 9421 HTTP
// Message Signatures) -- v0.0.9.21. Portaless NUNCA firma nada -- solo
// verifica firmas de agentes externos que reportan sobre la fuente
// "agent" de SiteTrustScore. Usa el paquete oficial `web-bot-auth`
// (verify() + verifierFromJWK()) en vez de reimplementar la
// reconstruccion del signature base string (RFC 9421 seccion 2.5).
//
// IMPORTANTE -- esto verifica IDENTIDAD, no AUTORIZACION. La autorizacion
// la resuelve la allowlist `authorized_agents` (ver schema.sql y
// authorized-agents.ts). Web Bot Auth resuelve "quien eres", la allowlist
// resuelve "tienes permiso".
//
// Cache del JWKS: fetchJwksWithCache() usa un KV namespace (env.JWKS_CACHE)
// con TTL. Sin KV, cae a fetch directo cada vez (con warning).
//
// v0.0.9.30 -- ML-DSA (FIPS 204, post-cuantico): si el JWK del agente es
// `kty: "AKP"`, `alg: "ML-DSA-44" | "ML-DSA-65" | "ML-DSA-87"`, clave
// publica en `pub`, se arma un verificador con @noble/post-quantum y se pasa
// al MISMO verify() de web-bot-auth. El camino Ed25519 no cambia.
//
// ORDEN DE ARGUMENTOS (PR #54): en @noble/post-quantum 0.5.x es
// verify(firma, mensaje, clavePublica). Con el orden equivocado verify()
// lanzaba y el try/catch lo convertia en false sin error visible. Si se
// actualiza la libreria, revisar este orden primero.
//
// PR H -- la lectura de Signature-Agent y Signature-Input vive en
// webbotauth/headers.ts, compartida con el verificador del middleware
// (webbotauth/verify.ts), para que los dos apliquen exactamente las mismas
// reglas de draft-03 en todas las plataformas. Se reexportan aca para no
// romper imports existentes. Cambio respecto de PR C: ya no se acepta
// Signature-Agent sin comillas ni sin esquema, y signature-agent tiene que
// estar entre los componentes firmados.
//
// APW v1.2 (5.3, ERRATA E-4): resolveAgentDirectoryKey() expone la clave del
// directorio del agente, con la misma cache, para verificar la atestacion
// JWS que el agente manda en el cuerpo. No cambia verifyWebBotAuthRequest().
//
// Advertencias honestas:
// - @noble/post-quantum no tiene todavia una auditoria independiente.
// - Aca solo se VERIFICAN firmas con claves publicas; el riesgo de canal
//   lateral es acotado.
// - createMlDsaVerifier() cumple las dos formas de verificador de
//   web-bot-auth (0.1.x y main). No se verifico contra un agente real ML-DSA.

import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { parseSignatureAgent, parseWebBotAuthSignatureInput } from "../webbotauth/headers";

export { parseSignatureAgent, parseWebBotAuthSignatureInput };
export type { SignatureInputParse } from "../webbotauth/headers";

const JWKS_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h -- las claves de un agente no rotan seguido

export interface WebBotAuthVerificationResult {
  verified: boolean;
  agentKeyId: string | null;
  /** Algoritmo de la clave que verifico la firma: "ed25519" o "ml-dsa-44/65/87". Coincide con authorized_agents.key_algorithm. */
  keyAlgorithm?: string;
  reason?: string;
}

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Jwk {
  kty: string;
  crv?: string;
  kid?: string;
  x?: string;
  /** ML-DSA (kty "AKP"): algoritmo concreto. */
  alg?: string;
  /** ML-DSA (kty "AKP"): clave publica en base64url. */
  pub?: string;
}

/** Clave publica tal como la publica el directorio Web Bot Auth del agente. */
export type AgentDirectoryJwk = Jwk;

interface Jwks {
  keys: Jwk[];
}

const ML_DSA_BY_ALG = {
  "ML-DSA-44": ml_dsa44,
  "ML-DSA-65": ml_dsa65,
  "ML-DSA-87": ml_dsa87,
} as const;

type MlDsaAlg = keyof typeof ML_DSA_BY_ALG;

export function isMlDsaJwk(jwk: { kty?: string; alg?: string }): boolean {
  return jwk.kty === "AKP" && typeof jwk.alg === "string" && jwk.alg in ML_DSA_BY_ALG;
}

/** Mapea un JWK al valor que usa authorized_agents.key_algorithm. */
export function jwkKeyAlgorithm(jwk: Jwk): string {
  if (isMlDsaJwk(jwk)) return (jwk.alg as string).toLowerCase();
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "ed25519";
  return "unknown";
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/**
 * Construye un verificador ML-DSA compatible con verify() de web-bot-auth.
 * Es a la vez una funcion (data, signature) que LANZA si la firma es
 * invalida (web-bot-auth 0.1.x) y un objeto { algorithm, keyid, verify }
 * que devuelve boolean (versiones posteriores).
 */
export function createMlDsaVerifier(jwk: Jwk) {
  if (!isMlDsaJwk(jwk)) throw new Error("unsupported_pq_algorithm");
  if (!jwk.pub) throw new Error("missing_ml_dsa_public_key");
  const impl = ML_DSA_BY_ALG[jwk.alg as MlDsaAlg];
  const publicKey = base64UrlToBytes(jwk.pub);

  const check = (data: string | Uint8Array, signature: Uint8Array): boolean => {
    try {
      // @noble/post-quantum 0.5.x: verify(firma, mensaje, clavePublica).
      return impl.verify(signature, toBytes(data), publicKey);
    } catch {
      return false;
    }
  };

  const fn = async (data: string | Uint8Array, signature: Uint8Array): Promise<void> => {
    if (!check(data, signature)) throw new Error("invalid_ml_dsa_signature");
  };

  return Object.assign(fn, {
    algorithm: (jwk.alg as string).toLowerCase(),
    keyid: jwk.kid ?? "",
    verify: async (data: string | Uint8Array, signature: Uint8Array): Promise<boolean> => check(data, signature),
  });
}

async function fetchJwksWithCache(signatureAgentUrl: string, kv?: KvNamespaceLike): Promise<Jwks> {
  const cacheKey = `jwks:${signatureAgentUrl}`;

  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as Jwks;
  } else {
    console.warn(
      "[Portaless WebBotAuth] Sin KV configurado -- cada verificacion hace fetch directo del JWKS. " +
        "Configura env.JWKS_CACHE para evitar latencia y dependencia de disponibilidad del agente."
    );
  }

  const directoryUrl = new URL("/.well-known/http-message-signatures-directory", signatureAgentUrl).toString();
  const res = await fetch(directoryUrl);
  if (!res.ok) {
    throw new Error(`No se pudo obtener el JWKS de ${directoryUrl} (HTTP ${res.status}).`);
  }
  const jwks = (await res.json()) as Jwks;

  if (kv) {
    await kv.put(cacheKey, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL_SECONDS });
  }

  return jwks;
}

function selectKeyByKeyId(jwks: Jwks, keyId: string): Jwk | null {
  return jwks.keys.find((k) => k.kid === keyId) ?? null;
}

/**
 * Clave publica `keyId` del directorio Web Bot Auth de `signatureAgent`,
 * con la misma cache que verifyWebBotAuthRequest(). null si no esta.
 * Lanza si el directorio no se puede leer.
 */
export async function resolveAgentDirectoryKey(
  signatureAgent: string,
  keyId: string,
  kv?: KvNamespaceLike
): Promise<AgentDirectoryJwk | null> {
  const jwks = await fetchJwksWithCache(signatureAgent, kv);
  return selectKeyByKeyId(jwks, keyId);
}

/**
 * Verifica la identidad del firmante de un request HTTP via Web Bot Auth.
 * NO consulta ninguna allowlist. Devuelve verified:false (nunca lanza).
 */
export async function verifyWebBotAuthRequest(
  request: Request,
  kv?: KvNamespaceLike
): Promise<WebBotAuthVerificationResult> {
  const signatureHeader = request.headers.get("Signature");
  const signatureInput = request.headers.get("Signature-Input");

  if (!signatureHeader || !signatureInput) {
    return { verified: false, agentKeyId: null, reason: "missing_signature_headers" };
  }

  const rawSignatureAgent = request.headers.get("Signature-Agent");
  if (!rawSignatureAgent) {
    return { verified: false, agentKeyId: null, reason: "missing_signature_agent_header" };
  }
  const signatureAgent = parseSignatureAgent(rawSignatureAgent);
  if (!signatureAgent) {
    return { verified: false, agentKeyId: null, reason: "invalid_signature_agent" };
  }

  const parsedInput = parseWebBotAuthSignatureInput(signatureInput);
  if (!parsedInput.ok) {
    return { verified: false, agentKeyId: null, reason: parsedInput.reason };
  }
  const keyId = parsedInput.keyId;

  try {
    const jwks = await fetchJwksWithCache(signatureAgent, kv);
    const jwk = selectKeyByKeyId(jwks, keyId);
    if (!jwk) {
      return { verified: false, agentKeyId: keyId, reason: "keyid_not_in_jwks" };
    }

    const keyAlgorithm = jwkKeyAlgorithm(jwk);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verifier: any = isMlDsaJwk(jwk) ? createMlDsaVerifier(jwk) : await verifierFromJWK(jwk as any);
    await verify(request, verifier);

    return { verified: true, agentKeyId: keyId, keyAlgorithm };
  } catch (err) {
    return { verified: false, agentKeyId: keyId, reason: (err as Error).message };
  }
}
