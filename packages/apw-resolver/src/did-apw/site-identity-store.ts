// packages/apw-resolver/src/did-apw/site-identity-store.ts
//
// Persistencia de la identidad did:apw de ESTE sitio (Wizard de
// onboarding, Paso 3-4). Mismo patron multi-backend que
// PermissionStore / PluginRegistryStore / AuthorizedEscrowProvidersStore
// (D1 en Cloudflare, SQLite self-hosted, InMemory para tests/dev sin DB).
//
// La clave privada nunca se persiste en claro -- se cifra con AES-GCM
// usando una clave de cifrado que vive FUERA de esta base de datos
// (PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY, env var, nunca en schema.sql).

import type { ApwKeyPair } from "./types";

export interface SiteIdentityRecord {
  siteId: string;
  did: string;
  domain: string;
  publicKeyJwk: JsonWebKey;
  keyAlgorithm: string;
  createdAt: string;
  createdBy: string;
}

export interface SiteIdentityStore {
  get(siteId: string): Promise<SiteIdentityRecord | null>;
  create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord>;
  getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null>;
}

const ENCRYPTION_KEY_ENV = "PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY";

async function getEncryptionKey(env: Record<string, string | undefined>): Promise<CryptoKey> {
  const rawKey = env[ENCRYPTION_KEY_ENV];
  if (!rawKey) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} no esta configurada -- requerida para cifrar la clave privada de site_identity. Generar con: openssl rand -base64 32`
    );
  }
  const keyBytes = Uint8Array.from(atob(rawKey), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptPrivateKey(
  privateKeyJwk: JsonWebKey,
  env: Record<string, string | undefined>
): Promise<{ ciphertext: string; iv: string }> {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

async function decryptPrivateKey(
  ciphertextBase64: string,
  ivBase64: string,
  env: Record<string, string | undefined>
): Promise<JsonWebKey> {
  const key = await getEncryptionKey(env);
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function rowToRecord(row: any): SiteIdentityRecord {
  return {
    siteId: row.site_id,
    did: row.did,
    domain: row.domain,
    publicKeyJwk: JSON.parse(row.public_key_jwk),
    keyAlgorithm: row.key_algorithm,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export class D1SiteIdentityStore implements SiteIdentityStore {
  constructor(private readonly db: D1Database, private readonly env: Record<string, string | undefined>) {}

  async get(siteId: string): Promise<SiteIdentityRecord | null> {
    const row = await this.db
      .prepare("SELECT site_id, did, domain, public_key_jwk, key_algorithm, created_at, created_by FROM site_identity WHERE site_id = ?")
      .bind(siteId)
      .first();
    return row ? rowToRecord(row) : null;
  }

  async create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord> {
    const { ciphertext, iv } = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    const createdAt = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO site_identity (site_id, did, domain, public_key_jwk, private_key_jwk_encrypted, private_key_encryption_iv, key_algorithm, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'ed25519', ?, ?)`
      )
      .bind(siteId, keyPair.did, keyPair.domain, JSON.stringify(keyPair.publicKeyJwk), ciphertext, iv, createdAt, createdBy)
      .run();
    return { siteId, did: keyPair.did, domain: keyPair.domain, publicKeyJwk: keyPair.publicKeyJwk, keyAlgorithm: "ed25519", createdAt, createdBy };
  }

  async getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null> {
    const row = await this.db
      .prepare("SELECT private_key_jwk_encrypted, private_key_encryption_iv FROM site_identity WHERE site_id = ?")
      .bind(siteId)
      .first<{ private_key_jwk_encrypted: string; private_key_encryption_iv: string }>();
    if (!row) return null;
    return decryptPrivateKey(row.private_key_jwk_encrypted, row.private_key_encryption_iv, this.env);
  }
}

export class SqliteSiteIdentityStore implements SiteIdentityStore {
  constructor(private readonly db: { prepare: (sql: string) => any }, private readonly env: Record<string, string | undefined>) {}

  async get(siteId: string): Promise<SiteIdentityRecord | null> {
    const row = this.db
      .prepare("SELECT site_id, did, domain, public_key_jwk, key_algorithm, created_at, created_by FROM site_identity WHERE site_id = ?")
      .get(siteId);
    return row ? rowToRecord(row) : null;
  }

  async create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord> {
    const { ciphertext, iv } = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO site_identity (site_id, did, domain, public_key_jwk, private_key_jwk_encrypted, private_key_encryption_iv, key_algorithm, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'ed25519', ?, ?)`
      )
      .run(siteId, keyPair.did, keyPair.domain, JSON.stringify(keyPair.publicKeyJwk), ciphertext, iv, createdAt, createdBy);
    return { siteId, did: keyPair.did, domain: keyPair.domain, publicKeyJwk: keyPair.publicKeyJwk, keyAlgorithm: "ed25519", createdAt, createdBy };
  }

  async getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null> {
    const row = this.db
      .prepare("SELECT private_key_jwk_encrypted, private_key_encryption_iv FROM site_identity WHERE site_id = ?")
      .get(siteId) as { private_key_jwk_encrypted: string; private_key_encryption_iv: string } | undefined;
    if (!row) return null;
    return decryptPrivateKey(row.private_key_jwk_encrypted, row.private_key_encryption_iv, this.env);
  }
}

export class InMemorySiteIdentityStore implements SiteIdentityStore {
  private records = new Map<string, SiteIdentityRecord>();
  private encryptedKeys = new Map<string, { ciphertext: string; iv: string }>();

  constructor(private readonly env: Record<string, string | undefined>) {}

  async get(siteId: string): Promise<SiteIdentityRecord | null> {
    return this.records.get(siteId) ?? null;
  }

  async create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord> {
    const { ciphertext, iv } = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    const record: SiteIdentityRecord = {
      siteId,
      did: keyPair.did,
      domain: keyPair.domain,
      publicKeyJwk: keyPair.publicKeyJwk,
      keyAlgorithm: "ed25519",
      createdAt: new Date().toISOString(),
      createdBy,
    };
    this.records.set(siteId, record);
    this.encryptedKeys.set(siteId, { ciphertext, iv });
    return record;
  }

  async getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null> {
    const stored = this.encryptedKeys.get(siteId);
    if (!stored) return null;
    return decryptPrivateKey(stored.ciphertext, stored.iv, this.env);
  }
}
