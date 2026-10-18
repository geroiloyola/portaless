// Almacen de artefactos de plugins (Fase 11.2). Guarda el CODIGO de un plugin
// instalado por HTTP, troceado en filas, para que el runtime pueda ejecutarlo
// sin depender de un filesystem (workerd no tiene).
//
// Por que troceado y BLOB (limites de D1):
//  - D1 impone ~2 MB por fila/string/BLOB y ~100 KB por sentencia. Un bundle
//    minificado + assets no entra en una fila, asi que se parte en chunks de
//    512 KB: fila hija (publisher, name, version, seq).
//  - Se guarda BLOB (Uint8Array/ArrayBuffer), NUNCA base64: base64 infla 33% y
//    deja el artefacto a un pelo del tope.
//  - Tope duro declarado por artefacto (MAX_ARTIFACT_BYTES) para no multiplicar
//    la cuota de filas de D1 sin control.
//
// El hash del codigo se guarda con el artefacto: reinstalar la MISMA version con
// bytes distintos debe fallar (si no, el hash no protege nada). Ver el instalador.
//
// Mismo patron D1 -> SQLite -> InMemory que el resto del repo. DDL tambien en
// schema-additions/plugin-artifacts.sql (schema.sql lo regenera).

import { openSqlite } from "../../../sqlite-driver/src/open";
import { validateManifest } from "../manifest/manifest-schema";
import type { PluginManifest } from "../types";

export const ARTIFACT_CHUNK_BYTES = 512 * 1024;
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_ARTIFACT_CHUNKS = Math.ceil(MAX_ARTIFACT_BYTES / ARTIFACT_CHUNK_BYTES);

export const ARTIFACTS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS plugin_artifacts (" +
  "publisher TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, " +
  "code_hash TEXT NOT NULL, total_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL, " +
  "created_at TEXT NOT NULL, manifest_json TEXT, PRIMARY KEY (publisher, name, version))";


export const ARTIFACT_CHUNKS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS plugin_artifact_chunks (" +
  "publisher TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, seq INTEGER NOT NULL, " +
  "data BLOB NOT NULL, PRIMARY KEY (publisher, name, version, seq))";

export interface PluginArtifactMeta {
  publisher: string;
  name: string;
  version: string;
  codeHash: string;
  totalBytes: number;
  chunkCount: number;
  createdAt: string;
  manifest?: PluginManifest;
}

export interface PluginArtifact {
  meta: PluginArtifactMeta;
  code: Uint8Array;
}

export interface PutArtifactInput {
  publisher: string;
  name: string;
  version: string;
  code: Uint8Array;
  codeHash?: string;
  createdAt?: string;
  manifest?: PluginManifest;
}

export interface PluginArtifactStore {
  put(input: PutArtifactInput): Promise<PluginArtifactMeta>;
  getMeta(publisher: string, name: string, version: string): Promise<PluginArtifactMeta | null>;
  get(publisher: string, name: string, version: string): Promise<PluginArtifact | null>;
  list(): Promise<PluginArtifactMeta[]>;
  delete(publisher: string, name: string, version: string): Promise<boolean>;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function assertIdentity(publisher: string, name: string, version: string): void {
  if (!publisher.startsWith("did:apw:") || publisher.length <= "did:apw:".length) throw new Error("invalid_publisher");
  if (typeof name !== "string" || name.length === 0 || name.length > 200) throw new Error("invalid_name");
  if (typeof version !== "string" || version.length === 0 || version.length > 64) throw new Error("invalid_version");
}

function normalizeManifest(manifest: PluginManifest | undefined, name: string, version: string): PluginManifest | undefined {
  if (manifest === undefined) return undefined;
  const check = validateManifest(manifest);
  if (!check.valid) throw new Error("invalid_manifest");
  if (manifest.name !== name || manifest.version !== version) throw new Error("manifest_identity_mismatch");
  return {
    name: manifest.name,
    version: manifest.version,
    entry: manifest.entry,
    runtime: manifest.runtime,
    requestedCapabilities: manifest.requestedCapabilities.map((c) => ({
      id: c.id,
      reason: c.reason,
      ...(c.allowedHosts ? { allowedHosts: [...c.allowedHosts] } : {}),
    })),
    ...(typeof manifest.description === "string" && manifest.description.length > 0 ? { description: manifest.description } : {}),
  };
}

function chunk(code: Uint8Array): Uint8Array[] {
  if (code.byteLength === 0) throw new Error("empty_artifact");
  if (code.byteLength > MAX_ARTIFACT_BYTES) throw new Error("artifact_too_large");
  const out: Uint8Array[] = [];
  for (let off = 0; off < code.byteLength; off += ARTIFACT_CHUNK_BYTES) {
    out.push(code.subarray(off, Math.min(off + ARTIFACT_CHUNK_BYTES, code.byteLength)));
  }
  return out;
}

export class InMemoryPluginArtifactStore implements PluginArtifactStore {
  private metas = new Map<string, PluginArtifactMeta>();
  private blobs = new Map<string, Uint8Array>();
  private key(p: string, n: string, v: string) {
    return `${p}\u0000${n}\u0000${v}`;
  }

  async put(input: PutArtifactInput): Promise<PluginArtifactMeta> {
    assertIdentity(input.publisher, input.name, input.version);
    const manifest = normalizeManifest(input.manifest, input.name, input.version);
    const parts = chunk(input.code);
    const meta: PluginArtifactMeta = {
      publisher: input.publisher,
      name: input.name,
      version: input.version,
      codeHash: input.codeHash ?? (await sha256Hex(input.code)),
      totalBytes: input.code.byteLength,
      chunkCount: parts.length,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(manifest ? { manifest } : {}),
    };
    const k = this.key(input.publisher, input.name, input.version);
    this.metas.set(k, meta);
    this.blobs.set(k, new Uint8Array(input.code)); // copia defensiva
    return meta;
  }

  async getMeta(publisher: string, name: string, version: string): Promise<PluginArtifactMeta | null> {
    return this.metas.get(this.key(publisher, name, version)) ?? null;
  }

  async get(publisher: string, name: string, version: string): Promise<PluginArtifact | null> {
    const meta = await this.getMeta(publisher, name, version);
    const code = this.blobs.get(this.key(publisher, name, version));
    if (!meta || !code) return null;
    return { meta, code: new Uint8Array(code) };
  }

  async list(): Promise<PluginArtifactMeta[]> {
    return [...this.metas.values()];
  }

  async delete(publisher: string, name: string, version: string): Promise<boolean> {
    const k = this.key(publisher, name, version);
    const had = this.metas.delete(k);
    this.blobs.delete(k);
    return had;
  }
}

export class D1PluginArtifactStore implements PluginArtifactStore {
  private ready?: Promise<unknown>;
  constructor(private db: any) {}

  private ensure() {
    return (this.ready ??= (async () => {
      await this.db.prepare(ARTIFACTS_TABLE_DDL).bind().run();
      await this.db.prepare(ARTIFACT_CHUNKS_TABLE_DDL).bind().run();
    })());
  }

  async put(input: PutArtifactInput): Promise<PluginArtifactMeta> {
    assertIdentity(input.publisher, input.name, input.version);
    const manifest = normalizeManifest(input.manifest, input.name, input.version);
    const parts = chunk(input.code);
    const meta: PluginArtifactMeta = {
      publisher: input.publisher,
      name: input.name,
      version: input.version,
      codeHash: input.codeHash ?? (await sha256Hex(input.code)),
      totalBytes: input.code.byteLength,
      chunkCount: parts.length,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(manifest ? { manifest } : {}),
    };
    const manifestJson = manifest ? JSON.stringify(manifest) : null;
    await this.ensure();
    // Reemplaza cualquier version previa de esa (publisher, name, version).
    await this.db
      .prepare("DELETE FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ?")
      .bind(meta.publisher, meta.name, meta.version)
      .run();
    await this.db
      .prepare(
        "INSERT INTO plugin_artifacts (publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(publisher, name, version) DO UPDATE SET code_hash = excluded.code_hash, total_bytes = excluded.total_bytes, chunk_count = excluded.chunk_count, created_at = excluded.created_at, manifest_json = excluded.manifest_json"
      )
      .bind(meta.publisher, meta.name, meta.version, meta.codeHash, meta.totalBytes, meta.chunkCount, meta.createdAt, manifestJson)
      .run();
    for (let seq = 0; seq < parts.length; seq++) {
      await this.db
        .prepare("INSERT INTO plugin_artifact_chunks (publisher, name, version, seq, data) VALUES (?, ?, ?, ?, ?)")
        .bind(meta.publisher, meta.name, meta.version, seq, parts[seq])
        .run();
    }
    return meta;
  }

  async getMeta(publisher: string, name: string, version: string): Promise<PluginArtifactMeta | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json FROM plugin_artifacts WHERE publisher = ? AND name = ? AND version = ?")
      .bind(publisher, name, version)
      .first();
    return row ? rowToMeta(row) : null;
  }

  async get(publisher: string, name: string, version: string): Promise<PluginArtifact | null> {
    const meta = await this.getMeta(publisher, name, version);
    if (!meta) return null;
    const { results } = await this.db
      .prepare("SELECT seq, data FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ? ORDER BY seq ASC")
      .bind(publisher, name, version)
      .all();
    return { meta, code: joinChunks(results ?? []) };
  }

  async list(): Promise<PluginArtifactMeta[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json FROM plugin_artifacts")
      .bind()
      .all();
    return (results ?? []).map(rowToMeta);
  }

  async delete(publisher: string, name: string, version: string): Promise<boolean> {
    await this.ensure();
    const existing = await this.getMeta(publisher, name, version);
    await this.db.prepare("DELETE FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ?").bind(publisher, name, version).run();
    await this.db.prepare("DELETE FROM plugin_artifacts WHERE publisher = ? AND name = ? AND version = ?").bind(publisher, name, version).run();
    return Boolean(existing);
  }
}

export class SqlitePluginArtifactStore implements PluginArtifactStore {
  private db: any;

  static async open(dbPath: string): Promise<SqlitePluginArtifactStore> {
    return new SqlitePluginArtifactStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("SqlitePluginArtifactStore no acepta una ruta en el constructor. Usa: await SqlitePluginArtifactStore.open(path)");
    }
    this.db = db;
    this.db.exec(ARTIFACTS_TABLE_DDL);
    this.db.exec(ARTIFACT_CHUNKS_TABLE_DDL);
  }

  async put(input: PutArtifactInput): Promise<PluginArtifactMeta> {
    assertIdentity(input.publisher, input.name, input.version);
    const manifest = normalizeManifest(input.manifest, input.name, input.version);
    const parts = chunk(input.code);
    const meta: PluginArtifactMeta = {
      publisher: input.publisher,
      name: input.name,
      version: input.version,
      codeHash: input.codeHash ?? (await sha256Hex(input.code)),
      totalBytes: input.code.byteLength,
      chunkCount: parts.length,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(manifest ? { manifest } : {}),
    };
    const manifestJson = manifest ? JSON.stringify(manifest) : null;
    this.db.prepare("DELETE FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ?").run(meta.publisher, meta.name, meta.version);
    this.db
      .prepare(
        "INSERT INTO plugin_artifacts (publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(publisher, name, version) DO UPDATE SET code_hash = excluded.code_hash, total_bytes = excluded.total_bytes, chunk_count = excluded.chunk_count, created_at = excluded.created_at, manifest_json = excluded.manifest_json"
      )
      .run(meta.publisher, meta.name, meta.version, meta.codeHash, meta.totalBytes, meta.chunkCount, meta.createdAt, manifestJson);
    for (let seq = 0; seq < parts.length; seq++) {
      this.db.prepare("INSERT INTO plugin_artifact_chunks (publisher, name, version, seq, data) VALUES (?, ?, ?, ?, ?)").run(meta.publisher, meta.name, meta.version, seq, Buffer.from(parts[seq]));
    }
    return meta;
  }

  async getMeta(publisher: string, name: string, version: string): Promise<PluginArtifactMeta | null> {
    const row = this.db
      .prepare("SELECT publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json FROM plugin_artifacts WHERE publisher = ? AND name = ? AND version = ?")
      .get(publisher, name, version);
    return row ? rowToMeta(row) : null;
  }

  async get(publisher: string, name: string, version: string): Promise<PluginArtifact | null> {
    const meta = await this.getMeta(publisher, name, version);
    if (!meta) return null;
    const rows = this.db
      .prepare("SELECT seq, data FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ? ORDER BY seq ASC")
      .all(publisher, name, version);
    return { meta, code: joinChunks(rows) };
  }

  async list(): Promise<PluginArtifactMeta[]> {
    return this.db.prepare("SELECT publisher, name, version, code_hash, total_bytes, chunk_count, created_at, manifest_json FROM plugin_artifacts").all().map(rowToMeta);
  }

  async delete(publisher: string, name: string, version: string): Promise<boolean> {
    const existing = await this.getMeta(publisher, name, version);
    this.db.prepare("DELETE FROM plugin_artifact_chunks WHERE publisher = ? AND name = ? AND version = ?").run(publisher, name, version);
    this.db.prepare("DELETE FROM plugin_artifacts WHERE publisher = ? AND name = ? AND version = ?").run(publisher, name, version);
    return Boolean(existing);
  }

  close(): void {
    this.db.close();
  }
}

function parseStoredManifest(raw: unknown, name: string, version: string): PluginManifest | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as PluginManifest;
    return normalizeManifest(parsed, name, version);
  } catch {
    console.warn(`plugin_artifacts: manifest_json invalido o corrupto para ${name}@${version} -- se descarta.`);
    return undefined;
  }
}

function rowToMeta(row: Record<string, unknown>): PluginArtifactMeta {
  const name = String(row.name);
  const version = String(row.version);
  const manifest = parseStoredManifest(row.manifest_json, name, version);
  return {
    publisher: String(row.publisher),
    name,
    version,
    codeHash: String(row.code_hash),
    totalBytes: Number(row.total_bytes),
    chunkCount: Number(row.chunk_count),
    createdAt: String(row.created_at),
    ...(manifest ? { manifest } : {}),
  };
}

function joinChunks(rows: Array<Record<string, unknown>>): Uint8Array {
  const parts = rows
    .slice()
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((r) => toBytes(r.data));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  throw new Error("invalid_chunk_data");
}

let cachedInMemoryArtifactStore: InMemoryPluginArtifactStore | null = null;

export function __resetPluginArtifactStoreForTests(): void {
  cachedInMemoryArtifactStore = null;
}

export async function createPluginArtifactStore(env: Record<string, any> = {}): Promise<PluginArtifactStore> {
  if (env.DB) return new D1PluginArtifactStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) return new SqlitePluginArtifactStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  console.warn("createPluginArtifactStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios).");
  if (!cachedInMemoryArtifactStore) {
    cachedInMemoryArtifactStore = new InMemoryPluginArtifactStore();
  }
  return cachedInMemoryArtifactStore;
}
