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

import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";

const JWKS_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h -- las claves de un agente no rotan seguido

export interface WebBotAuthVerificationResult {
  verified: boolean;
  agentKeyId: string | null;
  reason?: string;
}

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Jwk {
  kty: string;
  crv: string;
  kid?: string;
  x: string;
}

interface Jwks {
  keys: Jwk[];
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

    const verifier = await verifierFromJWK(jwk);
    await verify(request, verifier);

    return { verified: true, agentKeyId: keyId };
  } catch (err) {
    return { verified: false, agentKeyId: keyId, reason: (err as Error).message };
  }
}
