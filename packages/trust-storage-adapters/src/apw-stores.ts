// Portaless node SQLite/D1 storage adapters for APW (Node-L0).
import { openSqlite } from "@portaless/sqlite-driver";
import {
  D1SiteIdentityStore,
  SqliteSiteIdentityStore,
  InMemorySiteIdentityStore,
  type SiteIdentityStore,
} from "@verared/apw/did-apw";
import {
  D1AttestationLogStore,
  SqliteAttestationLogStore,
  InMemoryAttestationLogStore,
  type AttestationLogStore,
} from "@verared/apw/did-apw";
import {
  D1ReaderConductJtiStore,
  SqliteReaderConductJtiStore,
  InMemoryReaderConductJtiStore,
  type ReaderConductJtiStore,
} from "@verared/apw/scoring";
import {
  D1WitnessIndexStore,
  SqliteWitnessIndexStore,
  InMemoryWitnessIndexStore,
  type WitnessIndexStore,
} from "@verared/apw/did-apw";
import {
  LINKS_TABLE_DDL,
  InMemorySiteAtprotoLinksStore,
  type SiteAtprotoLink,
  type SiteAtprotoLinksStore,
} from "@verared/apw/did-apw";
import {
  recordInSiteHistoryWithStores,
  type HistoryRecordResult,
} from "@verared/apw/did-apw";
import {
  D1Adapter,
  SqliteAdapter,
  type SqlAdapter,
} from "@verared/apw/did-apw";
import {
  READ_POLICIES_DDL,
  InMemoryReadPolicyStore,
  normalizePublicOverrides,
  parseStoredOverrides,
  validateReadPolicyInput,
  type ReadPolicyInput,
  type ReadPolicyRecord,
  type ReadPolicyStore,
} from "@verared/apw/scoring";

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

function rowToLink(row: Record<string, unknown>): SiteAtprotoLink {
  return {
    siteId: row.site_id as string,
    handle: row.handle as string,
    addedAt: row.added_at as string,
  };
}

export class D1SiteAtprotoLinksStore implements SiteAtprotoLinksStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(LINKS_TABLE_DDL).bind().run());
  }

  async list(siteId: string): Promise<SiteAtprotoLink[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT site_id, handle, added_at FROM site_atproto_links WHERE site_id = ? ORDER BY added_at ASC")
      .bind(siteId)
      .all();
    return results.map(rowToLink);
  }

  async add(siteId: string, handle: string): Promise<SiteAtprotoLink> {
    await this.ensure();
    const normalized = handle.trim().toLowerCase();
    const existing = await this.db
      .prepare("SELECT site_id, handle, added_at FROM site_atproto_links WHERE site_id = ? AND handle = ?")
      .bind(siteId, normalized)
      .first();
    if (existing) return rowToLink(existing);
    const addedAt = new Date().toISOString();
    await this.db
      .prepare("INSERT INTO site_atproto_links (site_id, handle, added_at) VALUES (?, ?, ?)")
      .bind(siteId, normalized, addedAt)
      .run();
    return { siteId, handle: normalized, addedAt };
  }

  async remove(siteId: string, handle: string): Promise<boolean> {
    await this.ensure();
    const result = await this.db
      .prepare("DELETE FROM site_atproto_links WHERE site_id = ? AND handle = ?")
      .bind(siteId, handle.trim().toLowerCase())
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

export class SqliteSiteAtprotoLinksStore implements SiteAtprotoLinksStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteSiteAtprotoLinksStore> {
    return new SqliteSiteAtprotoLinksStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteSiteAtprotoLinksStore no acepta una ruta en el constructor. Usa: await SqliteSiteAtprotoLinksStore.open(path)",
      );
    }
    this.db = db;
    this.db.exec(LINKS_TABLE_DDL);
  }

  list(siteId: string): Promise<SiteAtprotoLink[]> {
    const rows = this.db
      .prepare("SELECT site_id, handle, added_at FROM site_atproto_links WHERE site_id = ? ORDER BY added_at ASC")
      .all(siteId);
    return Promise.resolve(rows.map(rowToLink));
  }

  add(siteId: string, handle: string): Promise<SiteAtprotoLink> {
    const normalized = handle.trim().toLowerCase();
    const existing = this.db
      .prepare("SELECT site_id, handle, added_at FROM site_atproto_links WHERE site_id = ? AND handle = ?")
      .get(siteId, normalized);
    if (existing) return Promise.resolve(rowToLink(existing));
    const addedAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO site_atproto_links (site_id, handle, added_at) VALUES (?, ?, ?)")
      .run(siteId, normalized, addedAt);
    return Promise.resolve({ siteId, handle: normalized, addedAt });
  }

  remove(siteId: string, handle: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM site_atproto_links WHERE site_id = ? AND handle = ?")
      .run(siteId, handle.trim().toLowerCase());
    return Promise.resolve((result?.changes ?? 0) > 0);
  }

  close(): void {
    this.db.close();
  }
}

export async function createSiteIdentityStore(env: Record<string, any>): Promise<SiteIdentityStore> {
  const encryptionKey =
    (typeof env?.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY === "string" && env.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY.trim()) ||
    (typeof env?.encryptionKey === "string" && env.encryptionKey.trim()) ||
    (typeof process !== "undefined" && typeof process.env?.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY === "string"
      ? process.env.PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY.trim()
      : "") ||
    undefined;
  const options = encryptionKey ? { encryptionKey } : {};
  if (env.DB) return new D1SiteIdentityStore(env.DB, options);
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteSiteIdentityStore(db, options);
  }
  console.warn(
    "[site-identity-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemorySiteIdentityStore. La identidad NO persistira entre reinicios.",
  );
  return new InMemorySiteIdentityStore(options);
}

export async function createWitnessIndexStore(env: Record<string, any>): Promise<WitnessIndexStore> {
  if (env.DB) return new D1WitnessIndexStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteWitnessIndexStore(db);
  }
  console.warn(
    "[witness-index-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemoryWitnessIndexStore. El directorio de testigos NO persistira entre reinicios.",
  );
  return new InMemoryWitnessIndexStore();
}

export async function createAttestationLogStore(env: Record<string, any>): Promise<AttestationLogStore> {
  if (env.DB) return new D1AttestationLogStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteAttestationLogStore(db);
  }
  console.warn(
    "[attestation-log-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemoryAttestationLogStore. El historial encadenado NO persistira entre reinicios.",
  );
  return new InMemoryAttestationLogStore();
}

export async function createReaderConductJtiStore(env: Record<string, any>): Promise<ReaderConductJtiStore> {
  if (env.DB) return new D1ReaderConductJtiStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteReaderConductJtiStore(db);
  }
  return new InMemoryReaderConductJtiStore();
}

export async function createSiteAtprotoLinksStore(env: Record<string, any>): Promise<SiteAtprotoLinksStore> {
  if (env.DB) return new D1SiteAtprotoLinksStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) {
    const db = await openSqlite(env.PORTALESS_SQLITE_PATH);
    return new SqliteSiteAtprotoLinksStore(db);
  }
  console.warn(
    "[atproto-links-store] Sin env.DB ni PORTALESS_SQLITE_PATH configurados -- usando InMemorySiteAtprotoLinksStore. Los vinculos AT no persistiran entre reinicios.",
  );
  return new InMemorySiteAtprotoLinksStore();
}

export async function recordInSiteHistory(
  env: Record<string, any>,
  subjectDid: string,
  attestationJws: string,
): Promise<HistoryRecordResult> {
  try {
    const identityStore = await createSiteIdentityStore(env);
    const logStore = await createAttestationLogStore(env);
    return await recordInSiteHistoryWithStores({ identityStore, logStore }, subjectDid, attestationJws);
  } catch (err) {
    console.warn(`[Portaless APW] No se pudo anotar la atestacion en el historial: ${(err as Error)?.message}`);
    return { logged: false, reason: "history_error" };
  }
}

const READ_POLICY_UPSERT_SQL = `INSERT INTO site_trust_read_policies
    (site_id, enabled, require_apw_identity, min_r01, min_r01_weight, min_r05, min_r05_weight, public_overrides, on_fail, updated_at, updated_by)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(site_id) DO UPDATE SET
    enabled = excluded.enabled,
    min_r01 = excluded.min_r01,
    min_r01_weight = excluded.min_r01_weight,
    min_r05 = excluded.min_r05,
    min_r05_weight = excluded.min_r05_weight,
    public_overrides = excluded.public_overrides,
    on_fail = excluded.on_fail,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by`;

function rowToReadPolicyRecord(row: Record<string, unknown>): ReadPolicyRecord {
  return {
    siteId: String(row.site_id),
    enabled: Number(row.enabled) === 1,
    requireApwIdentity: true,
    minR01: row.min_r01 === null || row.min_r01 === undefined ? null : Number(row.min_r01),
    minR01Weight: Number(row.min_r01_weight ?? 0),
    minR05: row.min_r05 === null || row.min_r05 === undefined ? null : Number(row.min_r05),
    minR05Weight: Number(row.min_r05_weight ?? 0),
    publicOverrides: parseStoredOverrides(row.public_overrides),
    onFail: String(row.on_fail) as ReadPolicyRecord["onFail"],
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by),
  };
}

export class SqlReadPolicyStore implements ReadPolicyStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql.run(READ_POLICIES_DDL);
      })();
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  async get(siteId: string): Promise<ReadPolicyRecord | null> {
    await this.ensureSchema();
    const row = await this.sql.first("SELECT * FROM site_trust_read_policies WHERE site_id = ?", [siteId]);
    return row ? rowToReadPolicyRecord(row) : null;
  }

  async save(input: ReadPolicyInput): Promise<ReadPolicyRecord> {
    validateReadPolicyInput(input);
    const publicOverrides = normalizePublicOverrides(input.publicOverrides);
    await this.ensureSchema();
    const updatedAt = new Date().toISOString();
    await this.sql.run(READ_POLICY_UPSERT_SQL, [
      input.siteId,
      input.enabled ? 1 : 0,
      input.minR01,
      input.minR01Weight,
      input.minR05,
      input.minR05Weight,
      publicOverrides.length ? JSON.stringify(publicOverrides) : null,
      input.onFail,
      updatedAt,
      input.updatedBy,
    ]);
    return { ...input, publicOverrides, requireApwIdentity: true, updatedAt };
  }
}

let readPolicyMemoryFallback: InMemoryReadPolicyStore | null = null;

export async function createReadPolicyStore(env: {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}): Promise<ReadPolicyStore> {
  if (env?.DB) return new SqlReadPolicyStore(new D1Adapter(env.DB as any));
  if (env?.PORTALESS_SQLITE_PATH) {
    return new SqlReadPolicyStore(new SqliteAdapter(await openSqlite(env.PORTALESS_SQLITE_PATH)));
  }
  if (!readPolicyMemoryFallback) {
    console.warn("[Portaless APW] Sin DB ni PORTALESS_SQLITE_PATH. Politica de lectura en memoria.");
    readPolicyMemoryFallback = new InMemoryReadPolicyStore();
  }
  return readPolicyMemoryFallback;
}
