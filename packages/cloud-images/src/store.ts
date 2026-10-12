// packages/cloud-images/src/store.ts
//
// Registro de Cloud Images: metadata firmada + bytes de la imagen en una
// sola fila (tabla cloud_images). Mismo patron D1 -> SQLite -> InMemory
// con factory que el resto del repo.
//
// El desacople hacia R2 (item externo del ROADMAP) es deliberado y esta
// documentado: hoy bytes y metadata viven juntos; sacar los bytes a un
// bucket externo = implementar ImageStorage con la misma interface de
// bytes y migrar la columna, sin tocar el formato ni los endpoints.

import { openSqlite } from "../../sqlite-driver/src/open";
import {
  parseSidecar,
  type CloudImageSidecar,
  type DeclaredOrigin,
} from "./payload";

export interface CloudImageRecord {
  imageId: string;
  contentHash: string;
  contentType: string;
  byteLength: number;
  declaredOrigin: DeclaredOrigin;
  siteId: string;
  siteDid: string;
  keyId: string;
  keyAlgorithm: string;
  signedAt: string;
  sidecar: CloudImageSidecar;
  createdBy: string | null;
  createdAt: string;
}

export interface CloudImagePutInput {
  sidecar: CloudImageSidecar;
  bytes: Uint8Array;
  /** kid usado para firmar (did:apw:<dominio>#key-<n>), del header del JWS. */
  keyId: string;
  createdBy?: string | null;
}

export interface CloudImageStore {
  put(input: CloudImagePutInput): Promise<CloudImageRecord>;
  get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null>;
  getByContentHash(contentHash: string): Promise<CloudImageRecord | null>;
  list(limit?: number): Promise<CloudImageRecord[]>;
  remove(imageId: string): Promise<boolean>;
}

export const CLOUD_IMAGES_TABLE_DDL = `CREATE TABLE IF NOT EXISTS cloud_images (
  image_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  declared_origin TEXT NOT NULL,
  site_id TEXT NOT NULL,
  site_did TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  signed_at TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
)`;

export const CLOUD_IMAGES_HASH_INDEX_DDL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_images_content_hash ON cloud_images (content_hash)";

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
  close(): unknown;
}

function toBytes(value: unknown): Uint8Array {
  // Copia siempre: better-sqlite3 devuelve Buffer (subclase de
  // Uint8Array) y el contrato es un Uint8Array plano.
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (value && typeof value === "object" && "type" in (value as object) && "data" in (value as object)) {
    // better-sqlite3 Buffer en algunos entornos viaja como { type, data }
    return Uint8Array.from((value as { data: number[] }).data);
  }
  throw new Error("invalid_blob");
}

function rowToRecord(row: Record<string, unknown>): CloudImageRecord | null {
  const sidecar = parseSidecar(safeJson(row.sidecar_json));
  if (!sidecar) return null;
  return {
    imageId: row.image_id as string,
    contentHash: row.content_hash as string,
    contentType: row.content_type as string,
    byteLength: Number(row.byte_length),
    declaredOrigin: row.declared_origin as DeclaredOrigin,
    siteId: row.site_id as string,
    siteDid: row.site_did as string,
    keyId: row.key_id as string,
    keyAlgorithm: row.key_algorithm as string,
    signedAt: row.signed_at as string,
    sidecar,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function putColumns(sidecar: CloudImageSidecar, keyId: string, createdBy: string | null, createdAt: string): Record<string, unknown> {
  const { payload } = sidecar;
  return {
    image_id: payload.imageId,
    content_hash: payload.contentHash,
    content_type: payload.contentType,
    byte_length: payload.byteLength,
    declared_origin: payload.declaredOrigin,
    site_id: payload.siteId,
    site_did: payload.siteDid,
    key_id: keyId,
    key_algorithm: payload.keyAlgorithm,
    signed_at: payload.signedAt,
    sidecar_json: JSON.stringify(sidecar),
    created_by: createdBy ?? null,
    created_at: createdAt,
  };
}

/** Valida ANTES de leer payload.* (sino un sidecar corrupto lanza TypeError). */
function validSidecar(input: CloudImagePutInput): CloudImageSidecar {
  const sidecar = parseSidecar(input.sidecar);
  if (!sidecar) throw new Error("invalid_sidecar");
  return sidecar;
}

export class D1CloudImageStore implements CloudImageStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= (async () => {
      await this.db.prepare(CLOUD_IMAGES_TABLE_DDL).bind().run();
      await this.db.prepare(CLOUD_IMAGES_HASH_INDEX_DDL).bind().run();
    })());
  }

  async put(input: CloudImagePutInput): Promise<CloudImageRecord> {
    await this.ensure();
    const sidecar = validSidecar(input);
    const columns = putColumns(sidecar, input.keyId, input.createdBy ?? null, new Date().toISOString());
    const keys = Object.keys(columns);
    const placeholders = keys.map(() => "?").join(", ");
    await this.db
      .prepare(`INSERT INTO cloud_images (${keys.join(", ")}, bytes) VALUES (${placeholders}, ?)`)
      .bind(...keys.map((k) => columns[k]), input.bytes as unknown)
      .run();
    return rowToRecord(columns) as CloudImageRecord;
  }

  async get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null> {
    await this.ensure();
    const row = await this.db.prepare("SELECT * FROM cloud_images WHERE image_id = ?").bind(imageId).first();
    if (!row) return null;
    const record = rowToRecord(row);
    if (!record) return null;
    return { record, bytes: toBytes(row.bytes) };
  }

  async getByContentHash(contentHash: string): Promise<CloudImageRecord | null> {
    await this.ensure();
    const row = await this.db.prepare("SELECT * FROM cloud_images WHERE content_hash = ?").bind(contentHash).first();
    return row ? rowToRecord(row) : null;
  }

  async list(limit = 100): Promise<CloudImageRecord[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT * FROM cloud_images ORDER BY created_at DESC LIMIT ?")
      .bind(limit)
      .all();
    return results.map(rowToRecord).filter((record): record is CloudImageRecord => record !== null);
  }

  async remove(imageId: string): Promise<boolean> {
    await this.ensure();
    const result = await this.db.prepare("DELETE FROM cloud_images WHERE image_id = ?").bind(imageId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

export class SqliteCloudImageStore implements CloudImageStore {
  private db: SqliteLike;

  static async open(dbPath: string): Promise<SqliteCloudImageStore> {
    return new SqliteCloudImageStore(await openSqlite(dbPath));
  }

  constructor(db: SqliteLike) {
    if (typeof db === "string") {
      throw new Error("SqliteCloudImageStore no acepta una ruta en el constructor. Usa: await SqliteCloudImageStore.open(path)");
    }
    this.db = db;
    this.db.exec(CLOUD_IMAGES_TABLE_DDL);
    this.db.exec(CLOUD_IMAGES_HASH_INDEX_DDL);
  }

  async put(input: CloudImagePutInput): Promise<CloudImageRecord> {
    const sidecar = validSidecar(input);
    const columns = putColumns(sidecar, input.keyId, input.createdBy ?? null, new Date().toISOString());
    const keys = Object.keys(columns);
    const placeholders = keys.map(() => "?").join(", ");
    this.db
      .prepare(`INSERT INTO cloud_images (${keys.join(", ")}, bytes) VALUES (${placeholders}, ?)`)
      .run(...keys.map((k) => columns[k]), input.bytes as unknown);
    return rowToRecord(columns) as CloudImageRecord;
  }

  get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null> {
    const row = this.db.prepare("SELECT * FROM cloud_images WHERE image_id = ?").get(imageId);
    if (!row) return Promise.resolve(null);
    const record = rowToRecord(row);
    if (!record) return Promise.resolve(null);
    return Promise.resolve({ record, bytes: toBytes(row.bytes) });
  }

  getByContentHash(contentHash: string): Promise<CloudImageRecord | null> {
    const row = this.db.prepare("SELECT * FROM cloud_images WHERE content_hash = ?").get(contentHash);
    return Promise.resolve(row ? rowToRecord(row) : null);
  }

  list(limit = 100): Promise<CloudImageRecord[]> {
    const rows = this.db.prepare("SELECT * FROM cloud_images ORDER BY created_at DESC LIMIT ?").all(limit);
    return Promise.resolve(rows.map(rowToRecord).filter((record): record is CloudImageRecord => record !== null));
  }

  remove(imageId: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM cloud_images WHERE image_id = ?").run(imageId);
    return Promise.resolve((result?.changes ?? 0) > 0);
  }

  close(): void {
    this.db.close();
  }
}

export class InMemoryCloudImageStore implements CloudImageStore {
  private rows = new Map<string, { record: CloudImageRecord; bytes: Uint8Array }>();

  put(input: CloudImagePutInput): Promise<CloudImageRecord> {
    const sidecar = parseSidecar(input.sidecar);
    if (!sidecar) return Promise.reject(new Error("invalid_sidecar"));
    const { payload } = sidecar;
    const record: CloudImageRecord = {
      imageId: payload.imageId,
      contentHash: payload.contentHash,
      contentType: payload.contentType,
      byteLength: payload.byteLength,
      declaredOrigin: payload.declaredOrigin,
      siteId: payload.siteId,
      siteDid: payload.siteDid,
      keyId: input.keyId,
      keyAlgorithm: payload.keyAlgorithm,
      signedAt: payload.signedAt,
      sidecar,
      createdBy: input.createdBy ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(record.imageId, { record, bytes: input.bytes.slice() });
    return Promise.resolve(record);
  }

  get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null> {
    const row = this.rows.get(imageId);
    return Promise.resolve(row ? { record: row.record, bytes: row.bytes.slice() } : null);
  }

  getByContentHash(contentHash: string): Promise<CloudImageRecord | null> {
    for (const row of this.rows.values()) {
      if (row.record.contentHash === contentHash) return Promise.resolve(row.record);
    }
    return Promise.resolve(null);
  }

  list(limit = 100): Promise<CloudImageRecord[]> {
    const records = [...this.rows.values()]
      .map((row) => row.record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return Promise.resolve(records);
  }

  remove(imageId: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(imageId));
  }
}

export async function createCloudImageStore(env: Record<string, unknown>): Promise<CloudImageStore> {
  if (env.DB) return new D1CloudImageStore(env.DB as D1Like);
  if (env.PORTALESS_SQLITE_PATH) return SqliteCloudImageStore.open(env.PORTALESS_SQLITE_PATH as string);
  console.warn(
    "[cloud-images] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemoryCloudImageStore. Las imagenes no persistiran entre reinicios."
  );
  return new InMemoryCloudImageStore();
}
