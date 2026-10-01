// Verificador Web Bot Auth del middleware. Solo usa WebCrypto, sin
// dependencias: es el que corre en Cloudflare Pages, en self-host Node y en
// cualquier otra plataforma con Functions.
//
// PR H: la lectura de Signature-Agent y Signature-Input sale de headers.ts,
// compartido con site-trust/web-bot-auth.ts. Antes se hacia new URL() sobre
// el header crudo: el formato estandar con comillas siempre fallaba y la
// forma sin comillas (no estandar) pasaba. Tambien se exigen created y
// expires (draft-03) y se devuelve agentKeyId, el mismo campo que el
// verificador de site-trust, que es el que lee el middleware para el ledger.

import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  base64UrlToBytes,
} from "./rfc9421";
import { parseSignatureAgent, parseWebBotAuthSignatureInput } from "./headers";

export interface KeyRecord {
  keyId: string;
  operator: string;
  publicKeyJwk?: { kty: string; crv?: string; x?: string; alg?: string };
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
  agentKeyId?: string | null;
  keyAlgorithm?: string;
  keyRecord?: KeyRecord;
}

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
const MAX_SIGNATURE_AGE_SECONDS = 300;

// v0.0.9: cache del directorio de claves con TTL, para no hacer un fetch()
// nuevo en cada request del mismo operador. Ver ROADMAP.md "Cache del
// directorio de claves Web Bot Auth". Shape propio (JWK OKP crudo), distinto
// del de key-directory.ts.
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos.

interface DirectoryResponse {
  keys: Array<{ kid: string; kty: string; crv?: string; x?: string; alg?: string }>;
}

interface DirectoryCacheEntry {
  directory: DirectoryResponse;
  expiresAt: number; // epoch ms
}

const directoryCache = new Map<string, DirectoryCacheEntry>();

/** Solo para tests: vacia el cache de directorios entre casos. */
export function __resetDirectoryCacheForTests(): void {
  directoryCache.clear();
}

async function fetchOperatorKeyDirectory(operatorOrigin: string): Promise<DirectoryResponse | null> {
  const cached = directoryCache.get(operatorOrigin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.directory;
  }

  try {
    const res = await fetch(new URL(DIRECTORY_PATH, operatorOrigin).toString(), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const directory = (await res.json()) as DirectoryResponse;
    directoryCache.set(operatorOrigin, { directory, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
    return directory;
  } catch {
    return null;
  }
}

// v0.0.9: unicidad de nonce contra replay, ver ROADMAP.md. En memoria por
// proceso: con multiples workers sin estado compartido cada uno tiene su
// propia ventana (limite conocido, documentado en README.md).
const NONCE_WINDOW_MS = MAX_SIGNATURE_AGE_SECONDS * 1000;
const seenNonces = new Map<string, number>(); // nonce -> expiresAt (epoch ms)

function pruneExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function registerNonceIfUnseen(nonce: string): boolean {
  const now = Date.now();
  pruneExpiredNonces(now);
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now + NONCE_WINDOW_MS);
  return true;
}

/** Solo para tests: vacia el store de nonces entre casos. */
export function __resetNonceStoreForTests(): void {
  seenNonces.clear();
}

export async function verifyWebBotAuthRequest(request: Request): Promise<VerifyResult> {
  const rawSignatureAgent = request.headers.get("Signature-Agent");
  if (!rawSignatureAgent) return { verified: false, reason: "missing_signature_agent_header" };

  const signatureInputHeader = request.headers.get("Signature-Input");
  const signatureHeader = request.headers.get("Signature");
  if (!signatureInputHeader || !signatureHeader) {
    return { verified: false, reason: "missing_signature_headers" };
  }

  const operatorOrigin = parseSignatureAgent(rawSignatureAgent);
  if (!operatorOrigin) return { verified: false, reason: "invalid_signature_agent" };

  const webBotAuth = parseWebBotAuthSignatureInput(signatureInputHeader);
  if (!webBotAuth.ok) return { verified: false, reason: webBotAuth.reason };

  const parsed = parseSignatureInput(signatureInputHeader);
  if (!parsed) return { verified: false, reason: "malformed_signature_input" };
  if (parsed.algorithm && parsed.algorithm !== "ed25519") {
    return { verified: false, reason: `unsupported_algorithm:${parsed.algorithm}` };
  }

  if (!parsed.created || !parsed.expires) return { verified: false, reason: "missing_created_or_expires" };
  const now = Math.floor(Date.now() / 1000);
  if (now - parsed.created > MAX_SIGNATURE_AGE_SECONDS) return { verified: false, reason: "signature_too_old" };
  if (now > parsed.expires) return { verified: false, reason: "signature_expired" };

  const directory = await fetchOperatorKeyDirectory(operatorOrigin);
  if (!directory) return { verified: false, reason: "key_directory_unreachable" };

  const keyEntry = directory.keys.find((k) => k.kid === parsed.keyId);
  if (!keyEntry) return { verified: false, reason: "keyid_not_in_directory" };
  if (keyEntry.kty !== "OKP" || keyEntry.crv !== "Ed25519" || !keyEntry.x) {
    return { verified: false, reason: "unsupported_key_type_in_directory" };
  }

  const signatureBytes = parseSignatureHeader(signatureHeader, parsed.label);
  if (!signatureBytes) return { verified: false, reason: "malformed_signature_header" };

  const signatureBase = buildSignatureBase(request, parsed);
  if (!signatureBase) return { verified: false, reason: "covered_header_missing" };
  const publicKeyRaw = base64UrlToBytes(keyEntry.x);

  const cryptoOk = await verifyEd25519Signature(signatureBase, signatureBytes, publicKeyRaw);
  if (!cryptoOk) return { verified: false, reason: "signature_verification_failed" };

  // El nonce se consume DESPUES de validar la firma: si no, cualquiera sin la
  // clave podria sondear que nonces ya se usaron.
  if (parsed.nonce) {
    const isFirstUse = registerNonceIfUnseen(parsed.nonce);
    if (!isFirstUse) return { verified: false, reason: "nonce_replayed" };
  }

  return {
    verified: true,
    agentKeyId: parsed.keyId,
    keyAlgorithm: "ed25519",
    keyRecord: { keyId: parsed.keyId, operator: operatorOrigin, publicKeyJwk: keyEntry },
  };
}
