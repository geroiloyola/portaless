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
//
// DECISION (v0.0.9.30): la clave de cifrado NO se deriva de la contrasena
// del admin. Se evaluo y se descarto: en un reset por email el servidor no
// conoce la contrasena vieja, asi que no puede descifrar para volver a
// cifrar, y la identidad quedaria irrecuperable. Con la clave del servidor,
// cambiar o resetear la contrasena no toca site_identity. Contra que
// protege: extraccion de la base de datos sola (sin las env vars). Contra
// que NO protege: alguien con acceso a la DB Y a las env vars del servidor.
//
// HISTORIAL DE CLAVES (APW v1.2, seccion 5.4): site_identity guarda la clave
// ACTUAL (lo que leen get() y el did.json). site_identity_keys guarda todas
// las claves que tuvo el sitio con su ventana valid_from / valid_to, para
// poder verificar entradas viejas del historial encadenado despues de rotar.
// rotate() cierra la clave vieja (valid_to) y BORRA su clave privada: para
// verificar alcanza la publica, y una privada retirada solo es riesgo. La
// rotacion es atomica (UPDATE site_identity + cerrar la vieja + insertar la
// nueva en una sola transaccion). Las tablas nuevas se crean al primer uso
// (CREATE IF NOT EXISTS) y la identidad que ya existia se copia sola a
// site_identity_keys la primera vez, asi no hace falta migrar a mano.
//
// IDENTIFICADORES DE CLAVE (ERRATA E-3): cada clave tiene dos identificadores.
//   kid      huella RFC 7638 (ERRATA E-1). Es lo que va en `k` del TXT.
//   keyId    did:apw:<dominio>#key-<n> (key_id / key_sequence). Es el `kid` de
//            los JWS que firma el sitio (APW v1.2, seccion 5.2).
// Las columnas key_id y key_sequence se agregan solas (ALTER TABLE) a las
// bases creadas por el PR #71, y las claves existentes reciben #key-1,
// #key-2... segun su fecha de alta.
//
// listKeys() ordena por key_sequence: es unica por sitio, a diferencia de
// valid_from, que puede empatar si dos rotaciones caen en el mismo
// milisegundo.

import type { ApwKeyPair } from "./types";
import { jwkThumbprint } from "./fingerprint";
import { didKeyId } from "./key-id";
import { D1Adapter, SqliteAdapter, type SqlAdapter, type SqlStatement } from "./sql-adapter";

export interface SiteIdentityRecord {
  siteId: string;
  did: string;
  domain: string;
  publicKeyJwk: JsonWebKey;
  keyAlgorithm: string;
  createdAt: string;
  createdBy: string;
}

/** Una clave que el sitio uso en algun momento. */
export interface SiteIdentityKeyRecord {
  /** Huella RFC 7638 (igual a `k` del TXT cuando la clave esta activa). */
  kid: string;
  /** did:apw:<dominio>#key-<n>: el `kid` de los JWS firmados con esta clave. */
  keyId: string;
  keySequence: number;
  siteId: string;
  publicKeyJwk: JsonWebKey;
  keyAlgorithm: string;
  validFrom: string;
  validTo: string | null;
}

export interface ActiveSigningKey {
  /** Huella RFC 7638. */
  kid: string;
  /** did:apw:<dominio>#key-<n>. */
  keyId: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface SiteIdentityStore {
  get(siteId: string): Promise<SiteIdentityRecord | null>;
  create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord>;
  /** Reemplaza la identidad existente por keyPair. Lanza "site_identity_not_found" si no hay identidad. */
  rotate(siteId: string, keyPair: ApwKeyPair, rotatedBy: string): Promise<SiteIdentityRecord>;
  getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null>;
  /** Todas las claves del sitio, de la mas vieja a la actual. */
  listKeys(siteId: string): Promise<SiteIdentityKeyRecord[]>;
  /** Clave activa con su privada descifrada, para firmar entradas del historial. */
  getActiveSigningKey(siteId: string): Promise<ActiveSigningKey | null>;
}

export const SITE_IDENTITY_NOT_FOUND = "site_identity_not_found";

const ENCRYPTION_KEY_ENV = "PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY";

async function getEncryptionKey(env: Record<string, any>): Promise<CryptoKey> {
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
  env: Record<string, any>
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
  env: Record<string, any>
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

function rowToKey(row: any): SiteIdentityKeyRecord {
  return {
    kid: row.kid,
    keyId: row.key_id,
    keySequence: Number(row.key_sequence),
    siteId: row.site_id,
    publicKeyJwk: JSON.parse(row.public_key_jwk),
    keyAlgorithm: row.key_algorithm,
    validFrom: row.valid_from,
    validTo: row.valid_to ?? null,
  };
}

const KEYS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS site_identity_keys (
    kid TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    public_key_jwk TEXT NOT NULL,
    private_key_encrypted TEXT,
    private_key_encryption_iv TEXT,
    key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    key_id TEXT,
    key_sequence INTEGER
  )`;

// Para bases creadas por el PR #71 (sin key_id / key_sequence). En una base
// nueva el CREATE TABLE ya las trae y el ALTER falla con "duplicate column",
// que se ignora.
const KEYS_ADD_COLUMNS_DDL = [
  "ALTER TABLE site_identity_keys ADD COLUMN key_id TEXT",
  "ALTER TABLE site_identity_keys ADD COLUMN key_sequence INTEGER",
];

const KEYS_INDEX_DDL = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_active ON site_identity_keys(site_id) WHERE valid_to IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_site_identity_keys_site ON site_identity_keys(site_id, valid_from)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_seq ON site_identity_keys(site_id, key_sequence)",
];

/** DDL de una base nueva. Una base de #71 necesita antes KEYS_ADD_COLUMNS_DDL (lo hace el store solo). */
export const SITE_IDENTITY_KEYS_DDL = [KEYS_TABLE_DDL, ...KEYS_INDEX_DDL];

const INSERT_IDENTITY_SQL =
  "INSERT INTO site_identity (site_id, did, domain, public_key_jwk, private_key_jwk_encrypted, private_key_encryption_iv, key_algorithm, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'ed25519', ?, ?)";

const UPDATE_IDENTITY_SQL =
  "UPDATE site_identity SET did = ?, domain = ?, public_key_jwk = ?, private_key_jwk_encrypted = ?, private_key_encryption_iv = ?, key_algorithm = 'ed25519', created_at = ?, created_by = ? WHERE site_id = ?";

// create() y rotate() usan INSERT estricto: si falla, se revierte toda la
// transaccion. Con INSERT OR IGNORE una rotacion podia cerrar la clave vieja
// y no insertar la nueva, dejando al sitio sin clave activa.
const INSERT_KEY_SQL =
  "INSERT INTO site_identity_keys (kid, site_id, public_key_jwk, private_key_encrypted, private_key_encryption_iv, key_algorithm, valid_from, valid_to, key_id, key_sequence) VALUES (?, ?, ?, ?, ?, 'ed25519', ?, NULL, ?, ?)";

const INSERT_KEY_IGNORE_SQL = INSERT_KEY_SQL.replace("INSERT INTO", "INSERT OR IGNORE INTO");

const CLOSE_ACTIVE_KEY_SQL =
  "UPDATE site_identity_keys SET valid_to = ?, private_key_encrypted = NULL, private_key_encryption_iv = NULL WHERE site_id = ? AND valid_to IS NULL";

const KEY_COLUMNS = "kid, key_id, key_sequence, site_id, public_key_jwk, key_algorithm, valid_from, valid_to";

function insertKey(
  siteId: string,
  kid: string,
  publicKeyJwk: JsonWebKey,
  ciphertext: string,
  iv: string,
  validFrom: string,
  keyId: string,
  keySequence: number,
  ignoreConflict = false
): SqlStatement {
  return {
    sql: ignoreConflict ? INSERT_KEY_IGNORE_SQL : INSERT_KEY_SQL,
    params: [kid, siteId, JSON.stringify(publicKeyJwk), ciphertext, iv, validFrom, keyId, keySequence],
  };
}

function isConstraintError(err: unknown): boolean {
  return /unique|constraint/i.test(String((err as Error)?.message));
}

/** Implementacion unica sobre SqlAdapter: D1 y SQLite comparten el mismo SQL. */
export class SqlSiteIdentityStore implements SiteIdentityStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter, private readonly env: Record<string, any>) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql.run(KEYS_TABLE_DDL);
        for (const alter of KEYS_ADD_COLUMNS_DDL) {
          try {
            await this.sql.run(alter);
          } catch (err) {
            if (!/duplicate column/i.test(String((err as Error)?.message))) throw err;
          }
        }
        for (const ddl of KEYS_INDEX_DDL) await this.sql.run(ddl);
      })();
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  /**
   * Deja site_identity_keys al dia para este sitio: copia la identidad que ya
   * existia (con key_id #key-1) y asigna key_id / key_sequence a las claves
   * creadas por el PR #71, en orden de fecha de alta.
   */
  private async ensureKeys(siteId: string): Promise<void> {
    await this.ensureSchema();
    const identity = await this.sql.first(
      "SELECT did, public_key_jwk, private_key_jwk_encrypted, private_key_encryption_iv, created_at FROM site_identity WHERE site_id = ?",
      [siteId]
    );
    if (!identity) return;

    const has = await this.sql.first("SELECT kid FROM site_identity_keys WHERE site_id = ? LIMIT 1", [siteId]);
    if (!has) {
      const publicKeyJwk = JSON.parse(identity.public_key_jwk) as JsonWebKey;
      const kid = await jwkThumbprint(publicKeyJwk);
      const stmt = insertKey(
        siteId,
        kid,
        publicKeyJwk,
        identity.private_key_jwk_encrypted,
        identity.private_key_encryption_iv,
        identity.created_at,
        didKeyId(identity.did, 1),
        1,
        true
      );
      await this.sql.run(stmt.sql, stmt.params);
    }
    await this.backfillKeyIds(siteId, identity.did);
  }

  private async maxKeySequence(siteId: string): Promise<number> {
    const row = await this.sql.first("SELECT COALESCE(MAX(key_sequence), 0) AS max_seq FROM site_identity_keys WHERE site_id = ?", [siteId]);
    return Number(row?.max_seq ?? 0);
  }

  private async backfillKeyIds(siteId: string, did: string): Promise<void> {
    const pending = await this.sql.all(
      "SELECT kid FROM site_identity_keys WHERE site_id = ? AND (key_id IS NULL OR key_sequence IS NULL) ORDER BY valid_from ASC, kid ASC",
      [siteId]
    );
    if (pending.length === 0) return;
    let sequence = await this.maxKeySequence(siteId);
    try {
      await this.sql.atomic(
        pending.map((row) => {
          sequence += 1;
          return {
            sql: "UPDATE site_identity_keys SET key_id = ?, key_sequence = ? WHERE kid = ?",
            params: [didKeyId(did, sequence), sequence, row.kid],
          };
        })
      );
    } catch (err) {
      // Otra peticion asigno las secuencias primero (indice unico): nada que hacer.
      if (!isConstraintError(err)) throw err;
    }
  }

  async get(siteId: string): Promise<SiteIdentityRecord | null> {
    const row = await this.sql.first(
      "SELECT site_id, did, domain, public_key_jwk, key_algorithm, created_at, created_by FROM site_identity WHERE site_id = ?",
      [siteId]
    );
    return row ? rowToRecord(row) : null;
  }

  async create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord> {
    await this.ensureSchema();
    const { ciphertext, iv } = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    const kid = await jwkThumbprint(keyPair.publicKeyJwk);
    const createdAt = new Date().toISOString();
    await this.sql.atomic([
      {
        sql: INSERT_IDENTITY_SQL,
        params: [siteId, keyPair.did, keyPair.domain, JSON.stringify(keyPair.publicKeyJwk), ciphertext, iv, createdAt, createdBy],
      },
      insertKey(siteId, kid, keyPair.publicKeyJwk, ciphertext, iv, createdAt, didKeyId(keyPair.did, 1), 1),
    ]);
    return { siteId, did: keyPair.did, domain: keyPair.domain, publicKeyJwk: keyPair.publicKeyJwk, keyAlgorithm: "ed25519", createdAt, createdBy };
  }

  async rotate(siteId: string, keyPair: ApwKeyPair, rotatedBy: string): Promise<SiteIdentityRecord> {
    await this.ensureKeys(siteId);
    const existing = await this.sql.first("SELECT site_id FROM site_identity WHERE site_id = ?", [siteId]);
    if (!existing) throw new Error(SITE_IDENTITY_NOT_FOUND);

    const { ciphertext, iv } = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    const kid = await jwkThumbprint(keyPair.publicKeyJwk);
    const sequence = (await this.maxKeySequence(siteId)) + 1;
    const now = new Date().toISOString();
    const [changed] = await this.sql.atomic([
      {
        sql: UPDATE_IDENTITY_SQL,
        params: [keyPair.did, keyPair.domain, JSON.stringify(keyPair.publicKeyJwk), ciphertext, iv, now, rotatedBy, siteId],
      },
      { sql: CLOSE_ACTIVE_KEY_SQL, params: [now, siteId] },
      insertKey(siteId, kid, keyPair.publicKeyJwk, ciphertext, iv, now, didKeyId(keyPair.did, sequence), sequence),
    ]);
    if (!changed) throw new Error(SITE_IDENTITY_NOT_FOUND);
    return { siteId, did: keyPair.did, domain: keyPair.domain, publicKeyJwk: keyPair.publicKeyJwk, keyAlgorithm: "ed25519", createdAt: now, createdBy: rotatedBy };
  }

  async getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null> {
    const row = await this.sql.first(
      "SELECT private_key_jwk_encrypted, private_key_encryption_iv FROM site_identity WHERE site_id = ?",
      [siteId]
    );
    if (!row) return null;
    return decryptPrivateKey(row.private_key_jwk_encrypted, row.private_key_encryption_iv, this.env);
  }

  async listKeys(siteId: string): Promise<SiteIdentityKeyRecord[]> {
    await this.ensureKeys(siteId);
    const rows = await this.sql.all(
      `SELECT ${KEY_COLUMNS} FROM site_identity_keys WHERE site_id = ? ORDER BY key_sequence ASC, valid_from ASC, kid ASC`,
      [siteId]
    );
    return rows.map(rowToKey);
  }

  async getActiveSigningKey(siteId: string): Promise<ActiveSigningKey | null> {
    await this.ensureKeys(siteId);
    const row = await this.sql.first(
      "SELECT kid, key_id, public_key_jwk, private_key_encrypted, private_key_encryption_iv FROM site_identity_keys WHERE site_id = ? AND valid_to IS NULL",
      [siteId]
    );
    if (!row || !row.key_id || !row.private_key_encrypted || !row.private_key_encryption_iv) return null;
    return {
      kid: row.kid,
      keyId: row.key_id,
      publicKeyJwk: JSON.parse(row.public_key_jwk),
      privateKeyJwk: await decryptPrivateKey(row.private_key_encrypted, row.private_key_encryption_iv, this.env),
    };
  }
}

export class D1SiteIdentityStore extends SqlSiteIdentityStore {
  constructor(db: D1Database, env: Record<string, any>) {
    super(new D1Adapter(db), env);
  }
}

export class SqliteSiteIdentityStore extends SqlSiteIdentityStore {
  constructor(db: { prepare: (sql: string) => any }, env: Record<string, any>) {
    super(new SqliteAdapter(db), env);
  }
}

interface MemoryKey {
  record: SiteIdentityKeyRecord;
  encrypted?: { ciphertext: string; iv: string };
}

export class InMemorySiteIdentityStore implements SiteIdentityStore {
  private records = new Map<string, SiteIdentityRecord>();
  private keys = new Map<string, MemoryKey[]>();

  constructor(private readonly env: Record<string, any>) {}

  async get(siteId: string): Promise<SiteIdentityRecord | null> {
    return this.records.get(siteId) ?? null;
  }

  private async newKey(siteId: string, keyPair: ApwKeyPair, validFrom: string, sequence: number): Promise<MemoryKey> {
    const encrypted = await encryptPrivateKey(keyPair.privateKeyJwk, this.env);
    return {
      record: {
        kid: await jwkThumbprint(keyPair.publicKeyJwk),
        keyId: didKeyId(keyPair.did, sequence),
        keySequence: sequence,
        siteId,
        publicKeyJwk: keyPair.publicKeyJwk,
        keyAlgorithm: "ed25519",
        validFrom,
        validTo: null,
      },
      encrypted,
    };
  }

  async create(siteId: string, keyPair: ApwKeyPair, createdBy: string): Promise<SiteIdentityRecord> {
    const createdAt = new Date().toISOString();
    const record: SiteIdentityRecord = {
      siteId,
      did: keyPair.did,
      domain: keyPair.domain,
      publicKeyJwk: keyPair.publicKeyJwk,
      keyAlgorithm: "ed25519",
      createdAt,
      createdBy,
    };
    this.records.set(siteId, record);
    this.keys.set(siteId, [await this.newKey(siteId, keyPair, createdAt, 1)]);
    return record;
  }

  async rotate(siteId: string, keyPair: ApwKeyPair, rotatedBy: string): Promise<SiteIdentityRecord> {
    const list = this.keys.get(siteId);
    if (!this.records.has(siteId) || !list) throw new Error(SITE_IDENTITY_NOT_FOUND);
    const now = new Date().toISOString();
    const sequence = list.reduce((max, k) => Math.max(max, k.record.keySequence), 0) + 1;
    const next = await this.newKey(siteId, keyPair, now, sequence);
    for (const k of list) {
      if (k.record.validTo === null) {
        k.record.validTo = now;
        k.encrypted = undefined;
      }
    }
    list.push(next);
    const record: SiteIdentityRecord = {
      siteId,
      did: keyPair.did,
      domain: keyPair.domain,
      publicKeyJwk: keyPair.publicKeyJwk,
      keyAlgorithm: "ed25519",
      createdAt: now,
      createdBy: rotatedBy,
    };
    this.records.set(siteId, record);
    return record;
  }

  async getDecryptedPrivateKey(siteId: string): Promise<JsonWebKey | null> {
    const active = this.keys.get(siteId)?.find((k) => k.record.validTo === null);
    if (!active?.encrypted) return null;
    return decryptPrivateKey(active.encrypted.ciphertext, active.encrypted.iv, this.env);
  }

  async listKeys(siteId: string): Promise<SiteIdentityKeyRecord[]> {
    return (this.keys.get(siteId) ?? []).map((k) => ({ ...k.record }));
  }

  async getActiveSigningKey(siteId: string): Promise<ActiveSigningKey | null> {
    const active = this.keys.get(siteId)?.find((k) => k.record.validTo === null);
    if (!active?.encrypted) return null;
    return {
      kid: active.record.kid,
      keyId: active.record.keyId,
      publicKeyJwk: active.record.publicKeyJwk,
      privateKeyJwk: await decryptPrivateKey(active.encrypted.ciphertext, active.encrypted.iv, this.env),
    };
  }
}
