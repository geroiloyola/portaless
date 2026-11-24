// Allowlist de proveedores de escrow autorizados a reportar sobre la
// fuente "escrow_report" de SiteTrustScore -- v0.0.9.23. Analoga a
// authorized-agents.ts, pero sin estandar publico equivalente a Web Bot
// Auth: la autenticacion es una API key hasheada por proveedor.
//
// hashApiKey() usa Web Crypto (SHA-256), la misma primitiva que
// functions/trust/[siteId]/vote.js para hashear IPs.
//
// No hay autoservicio: Portaless genera y entrega la API key fuera de
// banda. Es deliberadamente la barrera de entrada mas alta de las 4
// fuentes, coherente con que escrow_report es ground truth. Ver
// docs/architecture/site-trust-score.md.
//
// grant() GENERA la key y la devuelve en texto plano SOLO en su resultado;
// solo se persiste el hash SHA-256 (write-once, never readable). revoke()
// hace soft-delete (active = 0).
//
// v0.0.9.27: SqliteAuthorizedEscrowProvidersStore migrado de node:sqlite a
// better-sqlite3 via openSqlite(). Uso: await SqliteAuthorizedEscrowProvidersStore.open(path).
// La factory ya NO cae a memoria si PORTALESS_SQLITE_PATH esta definido y
// SQLite no abre (antes: todos los reportes de escrow rechazados en silencio).
//
// APW v1.2 (5.3, ERRATA E-4): cada proveedor puede registrar su clave publica
// Ed25519 (public_key_jwk). La API key sigue autenticando el endpoint; la
// clave publica verifica la atestacion JWS, que es la prueba exportable. Sin
// clave publica el proveedor no puede reportar. Re-autorizar sin clave
// conserva la que ya tenia (COALESCE). La API key se genera igual que en
// scripts/onboard-escrow-provider.mjs: prefijo pless_escrow_ + 32 bytes
// aleatorios en base64url.
//
// setPublicKey() carga, reemplaza o quita (null) la clave publica SIN rotar
// la API key ni cambiar el estado del proveedor. grant() rota la API key; para
// solo actualizar la clave, usar setPublicKey().


export interface AuthorizedEscrowProvider {
  providerId: string;
  displayName: string;
  active: boolean;
  authorizedAt: string;
  authorizedBy: string;
  /** Clave publica Ed25519 del proveedor ({ kty, crv, x }) o null si no registro ninguna. */
  publicKeyJwk: JsonWebKey | null;
}

export interface GrantAuthorizedEscrowProviderInput {
  providerId: string;
  displayName: string;
  authorizedBy: string;
  /** Clave publica Ed25519 del proveedor. Se valida con normalizeProviderPublicKey(). */
  publicKeyJwk?: JsonWebKey | null;
}

export interface GrantAuthorizedEscrowProviderResult {
  provider: AuthorizedEscrowProvider;
  /** API key en texto plano -- SOLO disponible en este resultado, nunca
   * se persiste ni se puede recuperar despues. Debe entregarse al
   * proveedor fuera de banda inmediatamente. */
  apiKey: string;
}

export interface AuthorizedEscrowProvidersStore {
  isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean>;
  list(): Promise<AuthorizedEscrowProvider[]>;
  grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult>;
  revoke(providerId: string): Promise<void>;
  /** Clave publica de un proveedor ACTIVO, o null. */
  getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null>;
  /**
   * Carga, reemplaza o quita (null) la clave publica sin rotar la API key.
   * Lanza INVALID_PUBLIC_KEY_JWK si la clave no es valida. Devuelve false si
   * el proveedor no existe.
   */
  setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean>;
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

export const INVALID_PUBLIC_KEY_JWK = "invalid_public_key_jwk";

const SET_PUBLIC_KEY_SQL = "UPDATE authorized_escrow_providers SET public_key_jwk = ? WHERE provider_id = ?";

function isDuplicateColumnError(err: unknown): boolean {
  return /duplicate column/i.test(String((err as Error)?.message));
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/, "");
}

/** Mismo formato que scripts/onboard-escrow-provider.mjs. */
export function generateApiKey(): string {
  return `pless_escrow_${bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * Valida una clave publica Ed25519 y la reduce a { kty, crv, x }. Acepta un
 * objeto o un string JSON. Lanza INVALID_PUBLIC_KEY_JWK; nunca acepta una
 * clave con `d` (privada).
 */
export function normalizeProviderPublicKey(input: unknown): JsonWebKey {
  let jwk: any = input;
  if (typeof input === "string") {
    try {
      jwk = JSON.parse(input);
    } catch {
      throw new Error(INVALID_PUBLIC_KEY_JWK);
    }
  }
  if (
    !jwk ||
    typeof jwk !== "object" ||
    jwk.kty !== "OKP" ||
    jwk.crv !== "Ed25519" ||
    typeof jwk.x !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
    jwk.d !== undefined
  ) {
    throw new Error(INVALID_PUBLIC_KEY_JWK);
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

/** null o undefined quitan la clave; cualquier otro valor tiene que ser una clave valida. */
function serializePublicKeyOrNull(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  return JSON.stringify(normalizeProviderPublicKey(input));
}

function parsePublicKey(raw: unknown): JsonWebKey | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeProviderPublicKey(raw);
  } catch {
    return null;
  }
}

export async function prepareGrant(input: GrantAuthorizedEscrowProviderInput) {
  const publicKeyJwk =
    input.publicKeyJwk === undefined || input.publicKeyJwk === null
      ? null
      : normalizeProviderPublicKey(input.publicKeyJwk);
  const apiKey = generateApiKey();
  return {
    apiKey,
    apiKeyHash: await hashApiKey(apiKey),
    authorizedAt: new Date().toISOString(),
    publicKeyJwk,
  };
}

export class InMemoryAuthorizedEscrowProvidersStore implements AuthorizedEscrowProvidersStore {
  private providers = new Map<string, MemoryProvider>();

  constructor(authorizedPairs: Set<string> = new Set()) {
    const now = new Date().toISOString();
    for (const pair of authorizedPairs) {
      const [providerId, apiKeyHash] = pair.split(":");
      this.providers.set(providerId, {
        providerId,
        displayName: providerId,
        active: true,
        authorizedAt: now,
        authorizedBy: "test-seed",
        publicKeyJwk: null,
        apiKeyHash,
      });
    }
  }

  async isAuthorized(providerId: string, apiKeyHash: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    return provider?.active === true && provider.apiKeyHash === apiKeyHash;
  }

  async list(): Promise<AuthorizedEscrowProvider[]> {
    return [...this.providers.values()].map(({ apiKeyHash, ...provider }) => provider);
  }

  async grant(input: GrantAuthorizedEscrowProviderInput): Promise<GrantAuthorizedEscrowProviderResult> {
    const { apiKey, apiKeyHash, authorizedAt, publicKeyJwk } = await prepareGrant(input);
    const previous = this.providers.get(input.providerId);
    const stored: MemoryProvider = {
      providerId: input.providerId,
      displayName: input.displayName,
      active: true,
      authorizedAt,
      authorizedBy: input.authorizedBy,
      publicKeyJwk: publicKeyJwk ?? previous?.publicKeyJwk ?? null,
      apiKeyHash,
    };
    this.providers.set(input.providerId, stored);
    const { apiKeyHash: _hash, ...provider } = stored;
    return { provider, apiKey };
  }

  async revoke(providerId: string): Promise<void> {
    const existing = this.providers.get(providerId);
    if (existing) existing.active = false;
  }

  async getPublicKeyJwk(providerId: string): Promise<JsonWebKey | null> {
    const provider = this.providers.get(providerId);
    return provider?.active ? provider.publicKeyJwk : null;
  }

  async setPublicKey(providerId: string, publicKeyJwk: unknown): Promise<boolean> {
    const serialized = serializePublicKeyOrNull(publicKeyJwk);
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    provider.publicKeyJwk = serialized ? JSON.parse(serialized) : null;
    return true;
  }
}

