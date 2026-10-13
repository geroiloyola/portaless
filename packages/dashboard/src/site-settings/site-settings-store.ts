// packages/dashboard/src/site-settings/site-settings-store.ts
//
// Ajustes generales del sitio (Phase 6 — publication maturity), en clave y
// valor. El repo no tenia ningun lugar donde guardarlos: site_skin guarda
// tokens de color, y el nombre/resumen del sitio eran variables de entorno
// con las que el admin no podia jugar. Una sola tabla (site_settings) con
// el mismo patron D1 -> SQLite -> InMemory que el resto del repo.
//
// La parte tipada (proveedores, validacion y emision del /api/analytics)
// vive en ./analytics-config.ts: es pura, sin imports de SQLite, para que
// el build estatico de Astro pueda importarla sin arrastrar better-sqlite3.

import { openSqlite } from "../../../sqlite-driver/src/open";
import {
  analyticsSettingsToValues,
  getAnalyticsSettings as readAnalyticsValues,
  sanitizeAnalyticsInput,
  type AnalyticsSettings,
  type AnalyticsValidation,
} from "./analytics-config";

export {
  ANALYTICS_KEYS,
  ANALYTICS_PROVIDERS,
  EMPTY_ANALYTICS,
  analyticsSettingsToValues,
  buildAnalyticsJs,
  isAnalyticsProvider,
  isSafeAnalyticsId,
  isSafeScriptUrl,
  parseAnalyticsSettings,
  sanitizeAnalyticsInput,
} from "./analytics-config";
export type { AnalyticsProvider, AnalyticsSettings, AnalyticsValidation } from "./analytics-config";

export const SITE_SETTINGS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS site_settings (" +
  "key TEXT PRIMARY KEY, " +
  "value TEXT NOT NULL DEFAULT '', " +
  "updated_at TEXT NOT NULL)";

export interface SiteSettingsStore {
  get(key: string): Promise<string | null>;
  getAll(keys: string[]): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
  setMany(values: Record<string, string>): Promise<void>;
}

/** Lee la config tipada desde el store (clave ausente = vacio). */
export async function getAnalyticsSettings(store: SiteSettingsStore): Promise<AnalyticsSettings> {
  return readAnalyticsValues(store);
}

/** Persiste la config validada. Rechaza lo que sanitizeAnalyticsInput rechazo. */
export async function saveAnalyticsSettings(
  store: SiteSettingsStore,
  input: unknown
): Promise<AnalyticsValidation> {
  const result = sanitizeAnalyticsInput(input);
  if (result.rejected.length === 0) {
    await store.setMany(analyticsSettingsToValues(result.settings));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Backends D1 / SQLite / InMemory
// ---------------------------------------------------------------------------

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

const MAX_KEY = 64;
const MAX_VALUE = 400;

function assertKeyValue(key: string, value: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY) {
    throw new Error(`site_settings: clave invalida (${MAX_KEY} max)`);
  }
  if (typeof value !== "string" || value.length > MAX_VALUE) {
    throw new Error(`site_settings: valor demasiado largo (${MAX_VALUE} max)`);
  }
}

export class D1SiteSettingsStore implements SiteSettingsStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(SITE_SETTINGS_TABLE_DDL).bind().run());
  }

  async get(key: string): Promise<string | null> {
    await this.ensure();
    const row = await this.db.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first();
    return row ? String(row.value ?? "") : null;
  }

  async getAll(keys: string[]): Promise<Record<string, string>> {
    await this.ensure();
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = (await this.get(key)) ?? "";
    return out;
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensure();
    assertKeyValue(key, value);
    const updatedAt = new Date().toISOString();
    const existing = await this.db.prepare("SELECT key FROM site_settings WHERE key = ?").bind(key).first();
    if (existing) {
      await this.db
        .prepare("UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?")
        .bind(value, updatedAt, key)
        .run();
    } else {
      await this.db
        .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)")
        .bind(key, value, updatedAt)
        .run();
    }
  }

  async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) await this.set(key, value);
  }
}

export class SqliteSiteSettingsStore implements SiteSettingsStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteSiteSettingsStore> {
    return new SqliteSiteSettingsStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("SqliteSiteSettingsStore no acepta una ruta en el constructor. Usa: await SqliteSiteSettingsStore.open(path)");
    }
    this.db = db;
    this.db.exec(SITE_SETTINGS_TABLE_DDL);
  }

  get(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM site_settings WHERE key = ?").get(key);
    return Promise.resolve(row ? String(row.value ?? "") : null);
  }

  async getAll(keys: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = (await this.get(key)) ?? "";
    return out;
  }

  // async a proposito: assertKeyValue lanza, y un throw sincronico no es
  // una promesa rechazada -- el caller con await/try-catch igual lo ve.
  async set(key: string, value: string): Promise<void> {
    assertKeyValue(key, value);
    const updatedAt = new Date().toISOString();
    const existing = this.db.prepare("SELECT key FROM site_settings WHERE key = ?").get(key);
    if (existing) {
      this.db.prepare("UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?").run(value, updatedAt, key);
    } else {
      this.db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, updatedAt);
    }
    return Promise.resolve();
  }

  async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) await this.set(key, value);
  }

  close(): void {
    this.db.close();
  }
}

export class InMemorySiteSettingsStore implements SiteSettingsStore {
  private rows = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.rows.has(key) ? this.rows.get(key)! : null);
  }

  async getAll(keys: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = (await this.get(key)) ?? "";
    return out;
  }

  async set(key: string, value: string): Promise<void> {
    assertKeyValue(key, value);
    this.rows.set(key, value);
  }

  async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) await this.set(key, value);
  }
}

export async function createSiteSettingsStore(env: Record<string, any>): Promise<SiteSettingsStore> {
  if (env.DB) {
    return new D1SiteSettingsStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return new SqliteSiteSettingsStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  }
  console.warn(
    "createSiteSettingsStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios)."
  );
  return new InMemorySiteSettingsStore();
}
