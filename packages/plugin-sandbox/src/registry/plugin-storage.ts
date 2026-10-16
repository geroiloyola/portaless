// Almacen clave-valor por plugin (Fase 14, §14.2) -- el primer backend real
// de capacidad de la fase. Detras de `storage:read` / `storage:write`, que
// hasta ahora respondian 501 (`NOT_CONFIGURED`) en el capability bridge.
//
// Por que un store propio y no KV generico:
//  - Namespace por plugin: la clave primaria es (plugin_id, key), y el
//    plugin_id lo fija el SERVIDOR (viene del token de ejecucion en el
//    bridge HTTP, o del manifiesto en el adaptador in-process), nunca el
//    body del plugin. Un plugin no puede leer ni pisar el espacio de otro.
//  - Cuotas: un plugin de terceros no puede llenar la base. Tope por valor,
//    por cantidad de claves y por bytes totales POR PLUGIN, aplicados al
//    escribir con un codigo de error explicito en vez de fallar en silencio.
//
// Mismo patron D1 -> SQLite -> InMemory que el resto del repo. DDL tambien en
// schema-additions/plugin-storage.sql (schema.sql lo regenera). El constructor
// de SqlitePluginStorageStore y el ensure() de D1 crean la tabla al vuelo, para
// bases creadas antes de esta version.

import { openSqlite } from "../../../sqlite-driver/src/open";

export const MAX_STORAGE_VALUE_BYTES = 64 * 1024; // 64 KiB por valor
export const MAX_STORAGE_KEYS_PER_PLUGIN = 256;
export const MAX_STORAGE_BYTES_PER_PLUGIN = 1024 * 1024; // 1 MiB por plugin

const KEY_RE = /^[A-Za-z0-9._:-]{1,256}$/;

export type PluginStorageErrorCode =
  | "STORAGE_INVALID_KEY"
  | "STORAGE_VALUE_TOO_LARGE"
  | "STORAGE_TOO_MANY_KEYS"
  | "STORAGE_QUOTA_EXCEEDED";

export class PluginStorageError extends Error {
  readonly code: PluginStorageErrorCode;
  constructor(code: PluginStorageErrorCode, message: string) {
    super(message);
    this.name = "PluginStorageError";
    this.code = code;
  }
}

export interface StoredValue {
  key: string;
  value: unknown;
  sizeBytes: number;
  updatedAt: string;
}

export interface StoredValueMeta {
  key: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface PluginStorageUsage {
  keys: number;
  bytes: number;
}

export interface PluginStorageStore {
  get(pluginId: string, key: string): Promise<StoredValue | null>;
  set(pluginId: string, key: string, value: unknown): Promise<StoredValue>;
  delete(pluginId: string, key: string): Promise<boolean>;
  list(pluginId: string): Promise<StoredValueMeta[]>;
  usage(pluginId: string): Promise<PluginStorageUsage>;
}

export const PLUGIN_STORAGE_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS plugin_storage (" +
  "plugin_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, " +
  "size_bytes INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, key))";

export const PLUGIN_STORAGE_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin ON plugin_storage(plugin_id)";

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== "string" || pluginId.length === 0) throw new Error("invalid_plugin_id");
}

/** Valida la clave y devuelve sus bytes serializados, o lanza un PluginStorageError. */
function serializeValue(key: string, value: unknown): { json: string; sizeBytes: number } {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw new PluginStorageError(
      "STORAGE_INVALID_KEY",
      "La clave debe tener entre 1 y 256 caracteres y solo [A-Za-z0-9._:-]."
    );
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new PluginStorageError("STORAGE_VALUE_TOO_LARGE", "El valor no es serializable a JSON.");
  }
  if (json === undefined) {
    throw new PluginStorageError("STORAGE_VALUE_TOO_LARGE", "El valor no es serializable a JSON.");
  }
  const sizeBytes = new TextEncoder().encode(json).byteLength;
  if (sizeBytes > MAX_STORAGE_VALUE_BYTES) {
    throw new PluginStorageError(
      "STORAGE_VALUE_TOO_LARGE",
      `El valor supera el tope de ${MAX_STORAGE_VALUE_BYTES} bytes por clave.`
    );
  }
  return { json, sizeBytes };
}

/**
 * Aplica las cuotas de escritura. `current` es lo que ya ocupa el plugin y
 * `previousSize` el tamano de la clave que se va a reemplazar (0 si es nueva).
 * Lanza STORAGE_TOO_MANY_KEYS / STORAGE_QUOTA_EXCEEDED.
 */
function assertWithinQuota(isNewKey: boolean, current: PluginStorageUsage, previousSize: number, newSize: number): void {
  if (isNewKey && current.keys + 1 > MAX_STORAGE_KEYS_PER_PLUGIN) {
    throw new PluginStorageError(
      "STORAGE_TOO_MANY_KEYS",
      `El plugin supera el tope de ${MAX_STORAGE_KEYS_PER_PLUGIN} claves.`
    );
  }
  const projectedBytes = current.bytes - previousSize + newSize;
  if (projectedBytes > MAX_STORAGE_BYTES_PER_PLUGIN) {
    throw new PluginStorageError(
      "STORAGE_QUOTA_EXCEEDED",
      `El plugin supera el tope de ${MAX_STORAGE_BYTES_PER_PLUGIN} bytes almacenados.`
    );
  }
}

export class InMemoryPluginStorageStore implements PluginStorageStore {
  // pluginId -> (key -> entry)
  private data = new Map<string, Map<string, StoredValue>>();

  private bucket(pluginId: string): Map<string, StoredValue> {
    let bucket = this.data.get(pluginId);
    if (!bucket) {
      bucket = new Map();
      this.data.set(pluginId, bucket);
    }
    return bucket;
  }

  async get(pluginId: string, key: string): Promise<StoredValue | null> {
    assertPluginId(pluginId);
    const entry = this.data.get(pluginId)?.get(key);
    return entry ? { ...entry } : null;
  }

  async set(pluginId: string, key: string, value: unknown): Promise<StoredValue> {
    assertPluginId(pluginId);
    const { json, sizeBytes } = serializeValue(key, value);
    const bucket = this.bucket(pluginId);
    const previous = bucket.get(key);
    assertWithinQuota(!previous, await this.usage(pluginId), previous?.sizeBytes ?? 0, sizeBytes);
    const entry: StoredValue = { key, value: JSON.parse(json), sizeBytes, updatedAt: new Date().toISOString() };
    bucket.set(key, entry);
    return { ...entry };
  }

  async delete(pluginId: string, key: string): Promise<boolean> {
    assertPluginId(pluginId);
    return this.data.get(pluginId)?.delete(key) ?? false;
  }

  async list(pluginId: string): Promise<StoredValueMeta[]> {
    assertPluginId(pluginId);
    const bucket = this.data.get(pluginId);
    if (!bucket) return [];
    return [...bucket.values()]
      .map((e) => ({ key: e.key, sizeBytes: e.sizeBytes, updatedAt: e.updatedAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async usage(pluginId: string): Promise<PluginStorageUsage> {
    assertPluginId(pluginId);
    const bucket = this.data.get(pluginId);
    if (!bucket) return { keys: 0, bytes: 0 };
    let bytes = 0;
    for (const entry of bucket.values()) bytes += entry.sizeBytes;
    return { keys: bucket.size, bytes };
  }
}

function rowToStoredValue(row: Record<string, unknown>): StoredValue {
  return {
    key: String(row.key),
    value: JSON.parse(String(row.value_json)),
    sizeBytes: Number(row.size_bytes),
    updatedAt: String(row.updated_at),
  };
}

export class D1PluginStorageStore implements PluginStorageStore {
  private ready?: Promise<unknown>;
  constructor(private db: any) {}

  private ensure() {
    return (this.ready ??= this.db
      .prepare(PLUGIN_STORAGE_TABLE_DDL)
      .bind()
      .run()
      .then(() => this.db.prepare(PLUGIN_STORAGE_INDEX_DDL).bind().run()));
  }

  async get(pluginId: string, key: string): Promise<StoredValue | null> {
    assertPluginId(pluginId);
    await this.ensure();
    const row = await this.db
      .prepare("SELECT key, value_json, size_bytes, updated_at FROM plugin_storage WHERE plugin_id = ? AND key = ?")
      .bind(pluginId, key)
      .first();
    return row ? rowToStoredValue(row) : null;
  }

  async set(pluginId: string, key: string, value: unknown): Promise<StoredValue> {
    assertPluginId(pluginId);
    const { json, sizeBytes } = serializeValue(key, value);
    await this.ensure();
    const existing = await this.get(pluginId, key);
    assertWithinQuota(!existing, await this.usage(pluginId), existing?.sizeBytes ?? 0, sizeBytes);
    const updatedAt = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO plugin_storage (plugin_id, key, value_json, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(plugin_id, key) DO UPDATE SET value_json = excluded.value_json, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at"
      )
      .bind(pluginId, key, json, sizeBytes, updatedAt)
      .run();
    return { key, value: JSON.parse(json), sizeBytes, updatedAt };
  }

  async delete(pluginId: string, key: string): Promise<boolean> {
    assertPluginId(pluginId);
    await this.ensure();
    const existing = await this.get(pluginId, key);
    await this.db.prepare("DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?").bind(pluginId, key).run();
    return Boolean(existing);
  }

  async list(pluginId: string): Promise<StoredValueMeta[]> {
    assertPluginId(pluginId);
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT key, size_bytes, updated_at FROM plugin_storage WHERE plugin_id = ? ORDER BY key ASC")
      .bind(pluginId)
      .all();
    return (results ?? []).map((row: Record<string, unknown>) => ({
      key: String(row.key),
      sizeBytes: Number(row.size_bytes),
      updatedAt: String(row.updated_at),
    }));
  }

  async usage(pluginId: string): Promise<PluginStorageUsage> {
    assertPluginId(pluginId);
    await this.ensure();
    const row = await this.db
      .prepare("SELECT COUNT(*) AS keys, COALESCE(SUM(size_bytes), 0) AS bytes FROM plugin_storage WHERE plugin_id = ?")
      .bind(pluginId)
      .first();
    return { keys: Number(row?.keys ?? 0), bytes: Number(row?.bytes ?? 0) };
  }
}

export class SqlitePluginStorageStore implements PluginStorageStore {
  private db: any;

  static async open(dbPath: string): Promise<SqlitePluginStorageStore> {
    return new SqlitePluginStorageStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("SqlitePluginStorageStore no acepta una ruta en el constructor. Usa: await SqlitePluginStorageStore.open(path)");
    }
    this.db = db;
    this.db.exec(PLUGIN_STORAGE_TABLE_DDL);
    this.db.exec(PLUGIN_STORAGE_INDEX_DDL);
  }

  async get(pluginId: string, key: string): Promise<StoredValue | null> {
    assertPluginId(pluginId);
    const row = this.db
      .prepare("SELECT key, value_json, size_bytes, updated_at FROM plugin_storage WHERE plugin_id = ? AND key = ?")
      .get(pluginId, key);
    return row ? rowToStoredValue(row) : null;
  }

  async set(pluginId: string, key: string, value: unknown): Promise<StoredValue> {
    assertPluginId(pluginId);
    const { json, sizeBytes } = serializeValue(key, value);
    const existing = await this.get(pluginId, key);
    assertWithinQuota(!existing, await this.usage(pluginId), existing?.sizeBytes ?? 0, sizeBytes);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO plugin_storage (plugin_id, key, value_json, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(plugin_id, key) DO UPDATE SET value_json = excluded.value_json, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at"
      )
      .run(pluginId, key, json, sizeBytes, updatedAt);
    return { key, value: JSON.parse(json), sizeBytes, updatedAt };
  }

  async delete(pluginId: string, key: string): Promise<boolean> {
    assertPluginId(pluginId);
    const existing = await this.get(pluginId, key);
    this.db.prepare("DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?").run(pluginId, key);
    return Boolean(existing);
  }

  async list(pluginId: string): Promise<StoredValueMeta[]> {
    assertPluginId(pluginId);
    const rows = this.db
      .prepare("SELECT key, size_bytes, updated_at FROM plugin_storage WHERE plugin_id = ? ORDER BY key ASC")
      .all(pluginId);
    return rows.map((row: Record<string, unknown>) => ({
      key: String(row.key),
      sizeBytes: Number(row.size_bytes),
      updatedAt: String(row.updated_at),
    }));
  }

  async usage(pluginId: string): Promise<PluginStorageUsage> {
    assertPluginId(pluginId);
    const row = this.db
      .prepare("SELECT COUNT(*) AS keys, COALESCE(SUM(size_bytes), 0) AS bytes FROM plugin_storage WHERE plugin_id = ?")
      .get(pluginId);
    return { keys: Number(row?.keys ?? 0), bytes: Number(row?.bytes ?? 0) };
  }

  close(): void {
    this.db.close();
  }
}

let cachedInMemoryStore: InMemoryPluginStorageStore | null = null;

export function __resetPluginStorageStoreForTests(): void {
  cachedInMemoryStore = null;
}

export interface PluginStorageStoreEnv {
  DB?: any;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createPluginStorageStore(env: PluginStorageStoreEnv = {}): Promise<PluginStorageStore> {
  if (env.DB) return new D1PluginStorageStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) return new SqlitePluginStorageStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  console.warn("createPluginStorageStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios).");
  if (!cachedInMemoryStore) cachedInMemoryStore = new InMemoryPluginStorageStore();
  return cachedInMemoryStore;
}
