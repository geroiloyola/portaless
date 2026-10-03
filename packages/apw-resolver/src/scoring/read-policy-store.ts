// packages/apw-resolver/src/scoring/read-policy-store.ts
//
// Politica de lectura del sitio (LTP v1.2, 6.5; ERRATA E-8). Configuracion
// GLOBAL del sitio (una fila por siteId), no un grant: por eso vive en su
// propia tabla tipada y no en el PermissionStore. Las excepciones por lector
// (bypass) seran grants del Centro de Permisos en un cambio posterior.
//
// Sin fila, o con enabled = 0, la lectura es publica (A.6: el valor por
// defecto de un sitio es publicar). Con enabled = 1 rige la politica; los
// valores por defecto son los de A.6 (APW + R-01 >= 5.0 y R-05 >= 5.0, cada
// una con suma de pesos >= 2.0).
//
// require_apw_identity queda fijo en 1 en el MVP (CHECK): una politica que
// exige reputacion sin identidad no tiene sentido, la reputacion es del DID.
//
// Mismo patron multi-backend que site-identity-store.ts (SqlAdapter para D1 y
// SQLite, memoria para dev sin DB). La tabla se crea al primer uso.

import { D1Adapter, SqliteAdapter, type SqlAdapter } from "../did-apw/sql-adapter";
import type { OnFail, ReadPolicy } from "./policy";

export interface ReadPolicyRecord {
  siteId: string;
  enabled: boolean;
  requireApwIdentity: true;
  minR01: number;
  minR01Weight: number;
  minR05: number;
  minR05Weight: number;
  onFail: OnFail;
  updatedAt: string;
  updatedBy: string;
}

export type ReadPolicyInput = Omit<ReadPolicyRecord, "updatedAt" | "requireApwIdentity">;

export const READ_POLICY_DEFAULTS = Object.freeze({
  minR01: 5.0,
  minR01Weight: 2.0,
  minR05: 5.0,
  minR05Weight: 2.0,
  onFail: "403" as OnFail,
});

export const READ_POLICIES_DDL = `CREATE TABLE IF NOT EXISTS site_trust_read_policies (
    site_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    require_apw_identity INTEGER NOT NULL DEFAULT 1 CHECK (require_apw_identity = 1),
    min_r01 REAL NOT NULL DEFAULT 5.0 CHECK (min_r01 >= 1 AND min_r01 <= 7),
    min_r01_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r01_weight >= 0),
    min_r05 REAL NOT NULL DEFAULT 5.0 CHECK (min_r05 >= 1 AND min_r05 <= 7),
    min_r05_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r05_weight >= 0),
    on_fail TEXT NOT NULL DEFAULT '403' CHECK (on_fail IN ('401', '402', '403')),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  )`;

export const INVALID_READ_POLICY = "invalid_read_policy";

export interface ReadPolicyStore {
  get(siteId: string): Promise<ReadPolicyRecord | null>;
  /** Lanza INVALID_READ_POLICY si algun valor esta fuera de rango. */
  save(input: ReadPolicyInput): Promise<ReadPolicyRecord>;
}

function inRange(x: unknown, lo: number, hi: number): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
}

export function validateReadPolicyInput(input: ReadPolicyInput): void {
  const ok =
    typeof input?.siteId === "string" &&
    input.siteId.length > 0 &&
    typeof input.enabled === "boolean" &&
    inRange(input.minR01, 1, 7) &&
    inRange(input.minR05, 1, 7) &&
    inRange(input.minR01Weight, 0, Number.MAX_SAFE_INTEGER) &&
    inRange(input.minR05Weight, 0, Number.MAX_SAFE_INTEGER) &&
    ["401", "402", "403"].includes(input.onFail) &&
    typeof input.updatedBy === "string" &&
    input.updatedBy.length > 0;
  if (!ok) throw new Error(INVALID_READ_POLICY);
}

/** Politica efectiva para evaluatePolicy(), o null si la lectura es publica. */
export function toReadPolicy(record: ReadPolicyRecord | null): ReadPolicy | null {
  if (!record || !record.enabled) return null;
  return {
    resource: "/trust/*",
    action: "read",
    require: {
      identity: "apw_verified",
      "R-01": { min: record.minR01, min_weight: record.minR01Weight },
      "R-05": { min: record.minR05, min_weight: record.minR05Weight },
    },
    on_fail: record.onFail,
  };
}

function rowToRecord(row: any): ReadPolicyRecord {
  return {
    siteId: row.site_id,
    enabled: Number(row.enabled) === 1,
    requireApwIdentity: true,
    minR01: Number(row.min_r01),
    minR01Weight: Number(row.min_r01_weight),
    minR05: Number(row.min_r05),
    minR05Weight: Number(row.min_r05_weight),
    onFail: String(row.on_fail) as OnFail,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const UPSERT_SQL = `INSERT INTO site_trust_read_policies
    (site_id, enabled, require_apw_identity, min_r01, min_r01_weight, min_r05, min_r05_weight, on_fail, updated_at, updated_by)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(site_id) DO UPDATE SET
    enabled = excluded.enabled,
    min_r01 = excluded.min_r01,
    min_r01_weight = excluded.min_r01_weight,
    min_r05 = excluded.min_r05,
    min_r05_weight = excluded.min_r05_weight,
    on_fail = excluded.on_fail,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by`;

export class SqlReadPolicyStore implements ReadPolicyStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = Promise.resolve(this.sql.run(READ_POLICIES_DDL)).then(() => undefined);
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  async get(siteId: string): Promise<ReadPolicyRecord | null> {
    await this.ensureSchema();
    const row = await this.sql.first("SELECT * FROM site_trust_read_policies WHERE site_id = ?", [siteId]);
    return row ? rowToRecord(row) : null;
  }

  async save(input: ReadPolicyInput): Promise<ReadPolicyRecord> {
    validateReadPolicyInput(input);
    await this.ensureSchema();
    const updatedAt = new Date().toISOString();
    await this.sql.run(UPSERT_SQL, [
      input.siteId,
      input.enabled ? 1 : 0,
      input.minR01,
      input.minR01Weight,
      input.minR05,
      input.minR05Weight,
      input.onFail,
      updatedAt,
      input.updatedBy,
    ]);
    return { ...input, requireApwIdentity: true, updatedAt };
  }
}

export class InMemoryReadPolicyStore implements ReadPolicyStore {
  private rows = new Map<string, ReadPolicyRecord>();

  async get(siteId: string): Promise<ReadPolicyRecord | null> {
    const row = this.rows.get(siteId);
    return row ? { ...row } : null;
  }

  async save(input: ReadPolicyInput): Promise<ReadPolicyRecord> {
    validateReadPolicyInput(input);
    const record: ReadPolicyRecord = { ...input, requireApwIdentity: true, updatedAt: new Date().toISOString() };
    this.rows.set(input.siteId, record);
    return { ...record };
  }
}

let memoryFallback: InMemoryReadPolicyStore | null = null;

export async function createReadPolicyStore(env: { DB?: unknown; PORTALESS_SQLITE_PATH?: string }): Promise<ReadPolicyStore> {
  if (env?.DB) return new SqlReadPolicyStore(new D1Adapter(env.DB as any));
  if (env?.PORTALESS_SQLITE_PATH) {
    const { openSqlite } = await import("../../../sqlite-driver/src/open");
    return new SqlReadPolicyStore(new SqliteAdapter(await openSqlite(env.PORTALESS_SQLITE_PATH)));
  }
  if (!memoryFallback) {
    console.warn("[Portaless APW] Sin DB ni PORTALESS_SQLITE_PATH. Politica de lectura en memoria.");
    memoryFallback = new InMemoryReadPolicyStore();
  }
  return memoryFallback;
}
