// Cuota diaria de emails por plugin (TASK 5, `email:send`).
//
// Un plugin de terceros nunca debe poder vaciar la reputacion del sitio
// enviando correo masivo. La cuota es por (plugin_id, dia UTC), el plugin_id lo
// fija el SERVIDOR (token de ejecucion / manifiesto), y el incremento es un
// UPDATE condicional ATOMICO: si el conteo ya llego al tope, la fila no cambia
// y el backend devuelve EMAIL_QUOTA_EXCEEDED.
//
// Mismo patron D1 -> SQLite -> InMemory que el resto del repo. DDL en
// schema-additions/plugin-email-quota.sql (schema.sql lo regenera).

import { openSqlite } from "../../../sqlite-driver/src/open";
import { PLUGIN_EMAIL_QUOTA_DDL } from "../../../persistence-migrations/src/ddl";

export const DEFAULT_DAILY_EMAIL_LIMIT = 50;

// La DDL vive en UN solo lugar (packages/persistence-migrations/src/ddl.ts) y la
// comparten el store y la migracion numerada. Se re-exporta por compatibilidad
// con quien la importe desde aca.
export { PLUGIN_EMAIL_QUOTA_DDL };

export interface QuotaConsumeResult {
  allowed: boolean;
  /** Conteo DESPUES del intento (si no se permitio, el conteo actual). */
  count: number;
  limit: number;
}

export interface PluginEmailQuotaStore {
  /** Consume un email del dia. Atomico: no supera `limit`. */
  consume(pluginId: string, day: string, limit: number): Promise<QuotaConsumeResult>;
  /** Conteo actual (diagnostico/doctor). */
  count(pluginId: string, day: string): Promise<number>;
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== "string" || !pluginId.trim()) throw new Error("plugin_id requerido para la cuota de email.");
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------
export class SqlitePluginEmailQuotaStore implements PluginEmailQuotaStore {
  private constructor(private db: any) {
    this.db.exec(PLUGIN_EMAIL_QUOTA_DDL);
  }

  static async open(sqlitePath: string): Promise<SqlitePluginEmailQuotaStore> {
    return new SqlitePluginEmailQuotaStore(await openSqlite(sqlitePath));
  }

  async consume(pluginId: string, day: string, limit: number): Promise<QuotaConsumeResult> {
    assertPluginId(pluginId);
    this.db.prepare("INSERT OR IGNORE INTO plugin_email_quota (plugin_id, day, count) VALUES (?, ?, 0)").run(pluginId, day);
    const res = this.db
      .prepare("UPDATE plugin_email_quota SET count = count + 1 WHERE plugin_id = ? AND day = ? AND count < ?")
      .run(pluginId, day, limit);
    const allowed = Number(res?.changes ?? 0) > 0;
    return { allowed, count: await this.count(pluginId, day), limit };
  }

  async count(pluginId: string, day: string): Promise<number> {
    const row = this.db.prepare("SELECT count FROM plugin_email_quota WHERE plugin_id = ? AND day = ?").get(pluginId, day);
    return Number(row?.count ?? 0);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------
export class D1PluginEmailQuotaStore implements PluginEmailQuotaStore {
  private ensured: Promise<unknown> | null = null;
  constructor(private db: any) {}

  private ensure(): Promise<unknown> {
    if (!this.ensured) this.ensured = this.db.prepare(PLUGIN_EMAIL_QUOTA_DDL).run();
    return this.ensured;
  }

  async consume(pluginId: string, day: string, limit: number): Promise<QuotaConsumeResult> {
    assertPluginId(pluginId);
    await this.ensure();
    await this.db.prepare("INSERT OR IGNORE INTO plugin_email_quota (plugin_id, day, count) VALUES (?, ?, 0)").bind(pluginId, day).run();
    const res = await this.db
      .prepare("UPDATE plugin_email_quota SET count = count + 1 WHERE plugin_id = ? AND day = ? AND count < ?")
      .bind(pluginId, day, limit)
      .run();
    const allowed = Number(res?.meta?.changes ?? res?.changes ?? 0) > 0;
    return { allowed, count: await this.count(pluginId, day), limit };
  }

  async count(pluginId: string, day: string): Promise<number> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT count FROM plugin_email_quota WHERE plugin_id = ? AND day = ?")
      .bind(pluginId, day)
      .first();
    return Number(row?.count ?? 0);
  }
}

// ---------------------------------------------------------------------------
// InMemory
// ---------------------------------------------------------------------------
export class InMemoryPluginEmailQuotaStore implements PluginEmailQuotaStore {
  private map = new Map<string, number>();

  async consume(pluginId: string, day: string, limit: number): Promise<QuotaConsumeResult> {
    assertPluginId(pluginId);
    const key = `${pluginId}\u0000${day}`;
    const current = this.map.get(key) ?? 0;
    if (current >= limit) return { allowed: false, count: current, limit };
    const next = current + 1;
    this.map.set(key, next);
    return { allowed: true, count: next, limit };
  }

  async count(pluginId: string, day: string): Promise<number> {
    return this.map.get(`${pluginId}\u0000${day}`) ?? 0;
  }
}

let cachedInMemoryStore: InMemoryPluginEmailQuotaStore | null = null;

export function __resetPluginEmailQuotaStoreForTests(): void {
  cachedInMemoryStore = null;
}

export interface PluginEmailQuotaStoreEnv {
  DB?: any;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createPluginEmailQuotaStore(env: PluginEmailQuotaStoreEnv = {}): Promise<PluginEmailQuotaStore> {
  if (env.DB) return new D1PluginEmailQuotaStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) return SqlitePluginEmailQuotaStore.open(env.PORTALESS_SQLITE_PATH);
  console.warn("createPluginEmailQuotaStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios).");
  if (!cachedInMemoryStore) cachedInMemoryStore = new InMemoryPluginEmailQuotaStore();
  return cachedInMemoryStore;
}
