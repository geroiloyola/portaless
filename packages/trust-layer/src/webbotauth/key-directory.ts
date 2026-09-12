// Directorio de claves publicas de Web Bot Auth.
//
// Referencia del estandar: draft-meunier-web-bot-auth-architecture (IETF).
// Cada operador de agente (OpenAI, Anthropic, un scraper independiente, etc.)
// publica su propia clave publica en su dominio, normalmente en
// "/.well-known/http-message-signatures-directory".
//
// Este archivo NO reimplementa el estandar completo (eso pertenece a una
// libreria dedicada de verificacion de HTTP Message Signatures). Aqui solo
// se define el modelo de datos que Portaless usa para resolver y cachear
// esas claves, siendo explicitamente agnostico al algoritmo de firma para
// permitir una migracion futura a esquemas post-cuanticos (ML-DSA, SLH-DSA)
// sin rediseñar el protocolo — ver docs/TRUST_LAYER_SETUP.md, seccion
// "Brecha post-cuantica".

export type SignatureAlgorithm =
  | "ed25519"       // Esquema usado hoy por la mayoria de implementaciones de Web Bot Auth.
  | "ecdsa-p256"
  | "ml-dsa-65"     // NIST FIPS 204 (post-cuantico) — soporte futuro.
  | "slh-dsa-128s"; // NIST FIPS 205 (post-cuantico) — soporte futuro.

export interface AgentKeyRecord {
  keyId: string;                 // Identificador unico de la clave (ej. "ed25519:9f2a...c31b").
  algorithm: SignatureAlgorithm;
  publicKeyPem: string;
  operatorDomain: string;        // Dominio donde el operador publica su directorio.
  operatorNameClaimed?: string;  // Nombre autodeclarado del agente (no verificado por si solo).
  fetchedAt: string;             // ISO 8601.
  expiresAt?: string;
}

const directoryCache = new Map<string, AgentKeyRecord[]>();

/**
 * Resuelve el directorio de claves publicado por un operador en su propio
 * dominio, siguiendo la convencion de Web Bot Auth
 * ("/.well-known/http-message-signatures-directory"). Usa cache en memoria
 * por proceso para no re-fetchear en cada request.
 */
export async function resolveAgentKeyDirectory(
  operatorDomain: string
): Promise<AgentKeyRecord[]> {
  const cached = directoryCache.get(operatorDomain);
  if (cached) return cached;

  const url = `https://${operatorDomain}/.well-known/http-message-signatures-directory`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `No se pudo resolver el directorio de claves de ${operatorDomain} (HTTP ${res.status})`
    );
  }

  const raw = (await res.json()) as { keys: AgentKeyRecord[] };
  directoryCache.set(operatorDomain, raw.keys);
  return raw.keys;
}

/**
 * Genera el propio directorio de claves publicas de un sitio Portaless
 * (necesario si el sitio, a su vez, opera agentes propios que deben
 * identificarse ante terceros — por ejemplo, un agente de indexacion interno).
 */
export function buildOwnKeyDirectory(keys: AgentKeyRecord[]) {
  return {
    version: "0.1",
    generator: "portaless-trust-layer",
    keys,
  };
}
