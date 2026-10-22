// Verificador Web Bot Auth del middleware. Usa WebCrypto para Ed25519 y
// @noble/post-quantum (carga perezosa, solo si el directorio trae una
// clave ML-DSA) para el camino post-cuantico -- corre igual en Cloudflare
// Pages, en self-host Node y en cualquier otra plataforma con Functions.
//
// PR H: la lectura de Signature-Agent y Signature-Input sale de headers.ts,
// compartido con site-trust/web-bot-auth.ts. Antes se hacia new URL() sobre
// el header crudo: el formato estandar con comillas siempre fallaba y la
// forma sin comillas (no estandar) pasaba. Tambien se exigen created y
// expires (draft-03) y se devuelve agentKeyId, el mismo campo que el
// verificador de site-trust, que es el que lee el middleware para el ledger.
//
// v0.0.9.31 -- ML-DSA (FIPS 204): hasta ahora este verificador (el del
// middleware, el que protege TODA request) era Ed25519-only, y ML-DSA
// vivia unicamente en la fuente "agent" de SiteTrustScore. Ahora el
// directorio del operador puede publicar claves `kty: "AKP"`,
// `alg: "ML-DSA-44|65|87"`, clave en `pub` (mismo formato que site-trust),
// y el parametro alg de Signature-Input acepta ml-dsa-44/65/87 ademas de
// ed25519 (draft-03 lo deja opcional; si viene, tiene que coincidir con
// el tipo de clave del directorio -- `algorithm_key_mismatch`). La
// verificacion ML-DSA reusa webbotauth/ml-dsa.ts, la MISMA implementacion
// que la fuente "agent": un solo lugar para la critografia de los dos
// verificadores. result.keyAlgorithm devuelve el algoritmo real usado
// ("ed25519" o "ml-dsa-44/65/87", minusculas, igual que
// authorized_agents.key_algorithm).
//
// v0.0.9.31 (anti-replay distribuido): los nonces dejan de vivir solo en
// un Map por proceso. verifyWebBotAuthRequest(request, { env }) registra
// los nonces en webbotauth_nonces (D1/SQLite con TTL, patron
// auth_mfa_challenges) cuando hay backend configurado, de modo que
// multiples instancias comparten la misma ventana de 300 s. Sin env se
// conserva el store en memoria (dev local y tests). Ver
// webbotauth/nonce-store.ts.

import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  base64UrlToBytes,
} from "./rfc9421";
import { parseSignatureAgent, parseWebBotAuthSignatureInput } from "./headers";
import { isMlDsaJwk, jwkKeyAlgorithm, normalizeAlgParam, verifyMlDsaSignature } from "./ml-dsa";
import {
  createWebBotAuthNonceStore,
  InMemoryWebBotAuthNonceStore,
  type NonceStoreFactoryEnv,
} from "./nonce-store";
import {
  createSafeFetcher,
  type SafeFetcher,
} from "../../../apw-resolver/src/federation/safe-fetch";

export interface KeyRecord {
  keyId: string;
  operator: string;
  publicKeyJwk?: { kty: string; crv?: string; x?: string; alg?: string; pub?: string };
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

/**
 * Clave canonica de cache: origen en minusculas, sin puerto por defecto, sin
 * punto final y con IDN ya convertido a punycode por WHATWG URL.
 */
function normalizeDirectoryOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    let host = url.hostname.toLowerCase();
    if (host.endsWith(".")) host = host.slice(0, -1);
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return origin.toLowerCase();
  }
}

// v0.0.9: cache del directorio de claves con TTL, para no hacer un fetch()
// nuevo en cada request del mismo operador. Ver ROADMAP.md "Cache del
// directorio de claves Web Bot Auth". Shape propio (JWK crudo: OKP/Ed25519
// con x, o AKP/ML-DSA-* con pub), distinto del de key-directory.ts.
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos.

interface DirectoryResponse {
  keys: Array<{ kid: string; kty: string; crv?: string; x?: string; alg?: string; pub?: string }>;
}

interface DirectoryCacheEntry {
  directory: DirectoryResponse;
  expiresAt: number; // epoch ms
}

const directoryCache = new Map<string, DirectoryCacheEntry>();

// B6: un origen invalido no debe generar un fetch nuevo en cada request.
// La cache negativa es corta (60 s) y acotada (LRU simple por insercion).
const NEGATIVE_CACHE_TTL_MS = 60_000;
export const DIRECTORY_NEGATIVE_CACHE_MAX = 256;
const negativeDirectoryCache = new Map<string, number>();
export const DIRECTORY_FETCH_IN_FLIGHT_MAX = 8;
let directoryFetchesInFlight = 0;

function rememberDirectoryFailure(origin: string): void {
  const now = Date.now();
  negativeDirectoryCache.delete(origin);
  negativeDirectoryCache.set(origin, now + NEGATIVE_CACHE_TTL_MS);
  while (negativeDirectoryCache.size > DIRECTORY_NEGATIVE_CACHE_MAX) {
    const oldest = negativeDirectoryCache.keys().next().value;
    if (oldest === undefined) break;
    negativeDirectoryCache.delete(oldest);
  }
}

/** Solo para tests: vacia cache positiva/negativa y contadores entre casos. */
export function __resetDirectoryCacheForTests(): void {
  directoryCache.clear();
  negativeDirectoryCache.clear();
  directoryFetchesInFlight = 0;
}

/** Solo para tests: estado acotado de las caches y fetches en vuelo. */
export function __directoryFetchStateForTests(): { positive: number; negative: number; inFlight: number } {
  return {
    positive: directoryCache.size,
    negative: negativeDirectoryCache.size,
    inFlight: directoryFetchesInFlight,
  };
}

async function fetchOperatorKeyDirectory(
  operatorOrigin: string,
  fetcher: SafeFetcher = createSafeFetcher(),
): Promise<DirectoryResponse | null> {
  const cacheKey = normalizeDirectoryOrigin(operatorOrigin);
  const cached = directoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.directory;
  }

  const failedUntil = negativeDirectoryCache.get(cacheKey);
  if (failedUntil !== undefined) {
    if (failedUntil > Date.now()) return null;
    negativeDirectoryCache.delete(cacheKey);
  }

  // Tope global: bajo una inundacion de origenes distintos se falla cerrado
  // en vez de abrir fetches sin limite. No se cachea este rechazo: es una
  // condicion de carga, no una propiedad del origen.
  if (directoryFetchesInFlight >= DIRECTORY_FETCH_IN_FLIGHT_MAX) return null;

  directoryFetchesInFlight += 1;
  let res: Awaited<ReturnType<SafeFetcher>>;
  try {
    res = await fetcher(new URL(DIRECTORY_PATH, cacheKey).toString(), {
      timeoutMs: 5000,
      maxBytes: 512 * 1024,
      maxRedirects: 2,
    });
  } catch {
    rememberDirectoryFailure(cacheKey);
    return null;
  } finally {
    directoryFetchesInFlight -= 1;
  }
  if (!res.ok || !res.text) {
    rememberDirectoryFailure(cacheKey);
    return null;
  }

  try {
    const directory = JSON.parse(res.text) as DirectoryResponse;
    if (!Array.isArray(directory?.keys)) {
      rememberDirectoryFailure(cacheKey);
      return null;
    }
    negativeDirectoryCache.delete(cacheKey);
    directoryCache.set(cacheKey, { directory, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
    return directory;
  } catch {
    rememberDirectoryFailure(cacheKey);
    return null;
  }
}

/** Solo para tests: ejercita el fetch interno sin fabricar una firma completa. */
export const __fetchOperatorKeyDirectoryForTests = fetchOperatorKeyDirectory;

// v0.0.9: unicidad de nonce contra replay, ver ROADMAP.md. v0.0.9.31:
// ahora compartido entre instancias. Si el caller pasa options.env (con
// env.DB / env.PORTALESS_SQLITE_PATH) el nonce se registra en
// webbotauth_nonces (D1/SQLite con TTL, patron auth_mfa_challenges) -- asi
// multiples workers de Cloudflare, dos instancias Docker, etc. comparten
// la misma ventana y un replay contra OTRO proceso se detecta. Sin env
// (dev local, tests, o un despliegue single-process sin estado) se cae al
// store en memoria de siempre, que NO comparte estado entre procesos
// (el factory avisa si no hay backend configurado).
const NONCE_WINDOW_MS = MAX_SIGNATURE_AGE_SECONDS * 1000;
const memoryNonceStore = new InMemoryWebBotAuthNonceStore();

/** Solo para tests: vacia el store de nonces en memoria entre casos. */
export function __resetNonceStoreForTests(): void {
  memoryNonceStore.clear();
}

export interface VerifyWebBotAuthOptions {
  env?: NonceStoreFactoryEnv;
  /** Solo para tests o runtimes que ya inyectan un fetcher endurecido. */
  directoryFetcher?: SafeFetcher;
}

export async function verifyWebBotAuthRequest(
  request: Request,
  options?: VerifyWebBotAuthOptions
): Promise<VerifyResult> {
  const rawSignatureAgent = request.headers.get("Signature-Agent");
  if (!rawSignatureAgent) return { verified: false, reason: "missing_signature_agent_header" };

  const signatureInputHeader = request.headers.get("Signature-Input");
  const signatureHeader = request.headers.get("Signature");
  if (!signatureInputHeader || !signatureHeader) {
    return { verified: false, reason: "missing_signature_headers" };
  }

  const parsedOperatorOrigin = parseSignatureAgent(rawSignatureAgent);
  if (!parsedOperatorOrigin) return { verified: false, reason: "invalid_signature_agent" };
  const operatorOrigin = normalizeDirectoryOrigin(parsedOperatorOrigin);

  const webBotAuth = parseWebBotAuthSignatureInput(signatureInputHeader);
  if (!webBotAuth.ok) return { verified: false, reason: webBotAuth.reason };

  const parsed = parseSignatureInput(signatureInputHeader);
  if (!parsed) return { verified: false, reason: "malformed_signature_input" };
  // draft-03 deja alg opcional; si viene, tiene que ser uno soportado.
  // La coherencia alg <-> tipo de clave del directorio se chequea despues,
  // cuando se conoce la clave (algorithm_key_mismatch).
  const algParam = parsed.algorithm ? normalizeAlgParam(parsed.algorithm) : null;
  if (parsed.algorithm && !algParam) {
    return { verified: false, reason: `unsupported_algorithm:${parsed.algorithm}` };
  }

  if (!parsed.created || !parsed.expires) return { verified: false, reason: "missing_created_or_expires" };
  const now = Math.floor(Date.now() / 1000);
  if (now - parsed.created > MAX_SIGNATURE_AGE_SECONDS) return { verified: false, reason: "signature_too_old" };
  if (now > parsed.expires) return { verified: false, reason: "signature_expired" };

  const directory = await fetchOperatorKeyDirectory(operatorOrigin, options?.directoryFetcher);
  if (!directory) return { verified: false, reason: "key_directory_unreachable" };

  const keyEntry = directory.keys.find((k) => k.kid === parsed.keyId);
  if (!keyEntry) return { verified: false, reason: "keyid_not_in_directory" };
  // Dos tipos de clave soportados: Ed25519 (OKP/crv Ed25519, x) y ML-DSA
  // (AKP/alg ML-DSA-44|65|87, pub). Cualquier otro kty/crv, o una clave
  // sin su material (x/pub), queda fuera.
  const keyAlgorithm = jwkKeyAlgorithm(keyEntry);
  const keyMaterialPresent = keyAlgorithm === "ed25519" ? Boolean(keyEntry.x) : Boolean(keyEntry.pub);
  if (keyAlgorithm === "unknown" || !keyMaterialPresent) {
    return { verified: false, reason: "unsupported_key_type_in_directory" };
  }
  if (algParam && algParam !== keyAlgorithm) {
    return { verified: false, reason: "algorithm_key_mismatch" };
  }

  const signatureBytes = parseSignatureHeader(signatureHeader, parsed.label);
  if (!signatureBytes) return { verified: false, reason: "malformed_signature_header" };

  const signatureBase = buildSignatureBase(request, parsed);
  if (!signatureBase) return { verified: false, reason: "covered_header_missing" };

  let cryptoOk: boolean;
  if (keyAlgorithm === "ed25519") {
    cryptoOk = await verifyEd25519Signature(signatureBase, signatureBytes, base64UrlToBytes(keyEntry.x!));
  } else {
    // ML-DSA: misma base de firma RFC 9421, otro esquema de firma. Si
    // @noble/post-quantum no se puede cargar, es un error de
    // infraestructura explicito, no un rechazo silencioso de todas las
    // firmas.
    try {
      cryptoOk = await verifyMlDsaSignature(
        keyEntry.alg as "ML-DSA-44" | "ML-DSA-65" | "ML-DSA-87",
        signatureBase,
        signatureBytes,
        base64UrlToBytes(keyEntry.pub!)
      );
    } catch (err) {
      return { verified: false, reason: `ml_dsa_unavailable: ${(err as Error).message}` };
    }
  }
  if (!cryptoOk) return { verified: false, reason: "signature_verification_failed" };

  // El nonce se consume DESPUES de validar la firma: si no, cualquiera sin la
  // clave podria sondear que nonces ya se usaron. Con options.env se usa el
  // store compartido (D1/SQLite); sin env, el store en memoria del proceso.
  if (parsed.nonce) {
    const nowMs = Date.now();
    const store = options?.env ? await createWebBotAuthNonceStore(options.env) : memoryNonceStore;
    const isFirstUse = await store.registerIfUnseen(parsed.nonce, nowMs, NONCE_WINDOW_MS);
    if (!isFirstUse) return { verified: false, reason: "nonce_replayed" };
  }

  return {
    verified: true,
    agentKeyId: parsed.keyId,
    keyAlgorithm,
    keyRecord: { keyId: parsed.keyId, operator: operatorOrigin, publicKeyJwk: keyEntry },
  };
}
