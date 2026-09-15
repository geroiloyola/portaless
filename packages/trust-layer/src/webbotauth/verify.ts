import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  base64UrlToBytes,
} from "./rfc9421";

export interface KeyRecord {
  keyId: string;
  operator: string;
  publicKeyJwk?: { kty: string; crv?: string; x?: string; alg?: string };
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
  keyRecord?: KeyRecord;
}

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
const MAX_SIGNATURE_AGE_SECONDS = 300;

// v0.0.9: cache del directorio de claves con TTL. Antes de este cambio,
// verifyWebBotAuthRequest() hacia un fetch() nuevo en CADA request, incluso
// para el mismo operador repetido miles de veces por minuto -- ver
// ROADMAP.md "Cache del directorio de claves Web Bot Auth". Reutiliza el
// mismo Map en memoria que key-directory.ts ya declaraba pero que ningun
// llamador usaba (resolveAgentKeyDirectory() nunca era invocado desde
// aqui); no se reexporta ese Map directamente porque su shape
// (AgentKeyRecord[], PEM) difiere del que este archivo necesita (JWK OKP
// crudo tal cual lo entrega el directorio remoto) -- se mantiene un cache
// propio con la MISMA politica de TTL para no mezclar ambos contratos.
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

// v0.0.9: verificacion de unicidad de nonce, para prevenir ataques de
// replay -- ver ROADMAP.md "verificacion de unicidad de nonce". Antes de
// este cambio, rfc9421.ts ya extraia el nonce de Signature-Input pero
// nada lo usaba: una request firmada legitima podia reenviarse tal cual
// (mismo Signature-Input + Signature) cuantas veces quisiera un atacante
// dentro de la ventana de MAX_SIGNATURE_AGE_SECONDS, y la firma seguiria
// validando porque criptograficamente es la misma request. Se guarda cada
// nonce visto con su vencimiento (mismo horizonte que la ventana de edad
// de firma: fuera de esa ventana la firma ya se rechaza por
// signature_too_old/signature_expired, asi que no hace falta recordar el
// nonce mas alla de eso). Nota: en memoria por proceso -- valido para un
// solo runtime; si Portaless corre en multiples workers/edge locations
// sin estado compartido, cada uno tiene su propia ventana de deduplicacion
// (documentado como limite conocido en README.md).
const NONCE_WINDOW_MS = MAX_SIGNATURE_AGE_SECONDS * 1000;
const seenNonces = new Map<string, number>(); // nonce -> expiresAt (epoch ms)

function pruneExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

/**
 * Registra un nonce si no se ha visto antes dentro de la ventana vigente.
 * Devuelve false (y NO lo registra otra vez) si es un replay.
 */
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
  const signatureAgent = request.headers.get("Signature-Agent");
  if (!signatureAgent) return { verified: false, reason: "missing_signature_agent_header" };

  const signatureInputHeader = request.headers.get("Signature-Input");
  const signatureHeader = request.headers.get("Signature");
  if (!signatureInputHeader || !signatureHeader) {
    return { verified: false, reason: "missing_signature_headers" };
  }

  const parsed = parseSignatureInput(signatureInputHeader);
  if (!parsed) return { verified: false, reason: "malformed_signature_input" };
  if (parsed.algorithm !== "ed25519") return { verified: false, reason: `unsupported_algorithm:${parsed.algorithm}` };

  if (parsed.expires) {
    const now = Math.floor(Date.now() / 1000);
    if (now > parsed.expires) return { verified: false, reason: "signature_expired" };
  }
  if (parsed.created) {
    const now = Math.floor(Date.now() / 1000);
    if (now - parsed.created > MAX_SIGNATURE_AGE_SECONDS) return { verified: false, reason: "signature_too_old" };
  }

  let operatorOrigin: string;
  try {
    operatorOrigin = new URL(signatureAgent).origin;
  } catch {
    return { verified: false, reason: "invalid_signature_agent_url" };
  }

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
  const publicKeyRaw = base64UrlToBytes(keyEntry.x);

  const cryptoOk = await verifyEd25519Signature(signatureBase, signatureBytes, publicKeyRaw);
  if (!cryptoOk) return { verified: false, reason: "signature_verification_failed" };

  // Unicidad de nonce: se revisa DESPUES de confirmar la firma valida, no
  // antes -- si se revisara antes, un atacante sin la clave privada podria
  // sondear que nonces ya fueron consumidos por el sitio (oraculo de
  // informacion) enviando firmas invalidas con distintos nonces. Solo una
  // request que ya demostro poseer la clave privada correcta llega a
  // consumir/gastar un nonce.
  if (parsed.nonce) {
    const isFirstUse = registerNonceIfUnseen(parsed.nonce);
    if (!isFirstUse) return { verified: false, reason: "nonce_replayed" };
  }

  return { verified: true, keyRecord: { keyId: parsed.keyId, operator: operatorOrigin, publicKeyJwk: keyEntry } };
}
