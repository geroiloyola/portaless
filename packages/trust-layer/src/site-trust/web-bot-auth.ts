// Verificacion de identidad de agentes via Web Bot Auth (RFC 9421 HTTP
// Message Signatures) -- v0.0.9.21. Portaless NUNCA firma nada -- solo
// verifica firmas de agentes externos que reportan sobre la fuente
// "agent" de SiteTrustScore. Usa el paquete oficial `web-bot-auth` de
// Cloudflare (verify() + verifierFromJWK()) en vez de reimplementar la
// reconstruccion del signature base string (RFC 9421 seccion 2.5) --
// ese formato especifico (ver draft-meunier-web-bot-auth-architecture)
// ya esta manejado correctamente por la libreria oficial.
//
// IMPORTANTE -- esto verifica IDENTIDAD, no AUTORIZACION. verify() aqui
// responde "¿esta firma es realmente de agent.example.com?", nunca
// "¿tiene agent.example.com permiso para reportar en Portaless?". Esa
// segunda pregunta la resuelve la allowlist `authorized_agents` (ver
// schema.sql y authorized-agents.ts) -- sin ella, cualquiera que genere
// un par Ed25519 y publique un JWKS podria reportar verified:true para
// cualquier sitio. Web Bot Auth resuelve "quien eres", la allowlist
// resuelve "tienes permiso".
//
// Cache del JWKS: Cloudflare Pages Functions no tiene estado entre
// invocaciones -- fetchJwksWithCache() usa un KV namespace (env.JWKS_CACHE)
// con TTL, para no golpear el dominio del agente en cada verificacion.
// Sin KV configurado, cae a fetch directo cada vez (mas lento, pero
// funcional -- nunca falla en silencio, ver el warning en el codigo).
//
// v0.0.9.30 -- ML-DSA (FIPS 204, post-cuantico). Antes este modulo solo
// verificaba Ed25519, aunque `authorized_agents` ya tenia la columna
// `key_algorithm` desde v0.0.9.24. Ahora, si el JWK del agente es de tipo
// post-cuantico (formato del borrador IETF de JOSE/COSE para ML-DSA:
// `kty: "AKP"`, `alg: "ML-DSA-44" | "ML-DSA-65" | "ML-DSA-87"`, clave
// publica en `pub` como base64url), se arma un verificador propio con
// @noble/post-quantum y se lo pasa al MISMO verify() de web-bot-auth, que
// sigue construyendo el signature base de RFC 9421. El camino Ed25519
// (verifierFromJWK) queda EXACTAMENTE igual que antes.
//
// Advertencias honestas:
// - @noble/post-quantum no tiene todavia una auditoria independiente
//   (lo dice su propio README), a diferencia de @noble/curves. Es la mejor
//   opcion en JS puro compatible con Node y workerd, pero no debe
//   presentarse como "auditada".
// - No hay proteccion contra ataques de canal lateral (tampoco en noble);
//   aca solo se VERIFICAN firmas con claves publicas, no se manejan
//   secretos, asi que el riesgo es acotado.
// - La forma del verificador que espera web-bot-auth cambio entre
//   versiones (funcion que lanza en 0.1.x vs. objeto con verify() que
//   devuelve boolean en main). createMlDsaVerifier() cumple ambas formas.
//   No se verifico todavia contra un agente real que firme con ML-DSA.

import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";

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
 * Es a la vez:
 *  - una funcion (data, signature) que LANZA si la firma es invalida
 *    (forma usada por web-bot-auth 0.1.x), y
 *  - un objeto con { algorithm, keyid, verify(data, signature) => boolean }
 *    (forma de la interfaz Verifier en versiones posteriores).
 * Lanza al construirse si el JWK no es ML-DSA o la clave publica esta vacia.
 */
export function createMlDsaVerifier(jwk: Jwk) {
  if (!isMlDsaJwk(jwk)) throw new Error("unsupported_pq_algorithm");
  if (!jwk.pub) throw new Error("missing_ml_dsa_public_key");
  const impl = ML_DSA_BY_ALG[jwk.alg as MlDsaAlg];
  const publicKey = base64UrlToBytes(jwk.pub);

  const check = (data: string | Uint8Array, signature: Uint8Array): boolean => {
    try {
      return impl.verify(publicKey, toBytes(data), signature);
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

// Extrae Signature-Agent del header del mismo nombre -- draft-meunier-
// web-bot-auth-architecture lo define como la URL base donde vive el
// directorio de claves del agente (no necesariamente el mismo dominio
// que Signature-Input/keyid, aunque en la practica suele coincidir).
function extractSignatureAgent(request: Request): string | null {
  return request.headers.get("Signature-Agent");
}

// Extrae el keyid declarado en el header Signature-Input -- necesario
// para seleccionar cual JWK del JWKS usar antes de poder verificar.
function extractKeyId(request: Request): string | null {
  const sigInput = request.headers.get("Signature-Input");
  if (!sigInput) return null;
  const match = sigInput.match(/keyid="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Verifica la identidad del firmante de un request HTTP via Web Bot Auth.
 * NO consulta ninguna allowlist -- ver comentario del modulo. Devuelve
 * verified:false (nunca lanza) para cualquier fallo de verificacion,
 * coherente con la semantica de AgentTrustVerification: la ausencia de
 * firma valida es una señal, no una excepcion no manejada.
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

  const signatureAgent = extractSignatureAgent(request);
  if (!signatureAgent) {
    return { verified: false, agentKeyId: null, reason: "missing_signature_agent_header" };
  }

  const keyId = extractKeyId(request);
  if (!keyId) {
    return { verified: false, agentKeyId: null, reason: "missing_keyid" };
  }

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
