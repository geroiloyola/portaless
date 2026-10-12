// packages/apw-resolver/src/did-apw/atproto-links-store.ts
//
// Vinculos OPCIONALES APW <-> AT Protocol: handles AT que el sitio
// reclama en su propio documento did:apw via `alsoKnownAs`
// (ver packages/identity-atproto/ y docs/architecture/identity-atproto.md).
// Una fila por (site, handle); la publicacion es en
// functions/.well-known/did.json.js (si no hay filas, el documento sale
// identico al de antes -- el puente es 100% opcional).
//
// Mismo patron D1 -> SQLite -> InMemory que createSiteIdentityStore()
// (store-factory.ts). La validacion sintactica del handle ocurre en el
// endpoint admin (parseHandle de identity-atproto); el store solo
// normaliza a minusculas y no inventa politica.

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface SiteAtprotoLink {
  siteId: string;
  handle: string;
  addedAt: string;
}

export interface SiteAtprotoLinksStore {
  /** Vinculos publicados por un sitio (siteId, p.ej. "default"). */
  list(siteId: string): Promise<SiteAtprotoLink[]>;
  /** Alta idempotente: si ya existia, devuelve la fila existente. */
  add(siteId: string, handle: string): Promise<SiteAtprotoLink>;
  /** Baja. true si habia algo que borrar. */
  remove(siteId: string, handle: string): Promise<boolean>;
}

export const LINKS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS site_atproto_links (" +
  "site_id TEXT NOT NULL, " +
  "handle TEXT NOT NULL, " +
  "added_at TEXT NOT NULL, " +
  "PRIMARY KEY (site_id, handle))";

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
}

function rowToLink(row: Record<string, unknown>): SiteAtprotoLink {
  return { siteId: row.site_id as string, handle: row.handle as string, addedAt: row.added_at as string };
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
        "SqliteSiteAtprotoLinksStore no acepta una ruta en el constructor. Usa: await SqliteSiteAtprotoLinksStore.open(path)"
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
    this.db.prepare("INSERT INTO site_atproto_links (site_id, handle, added_at) VALUES (?, ?, ?)").run(siteId, normalized, addedAt);
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

export class InMemorySiteAtprotoLinksStore implements SiteAtprotoLinksStore {
  private rows = new Map<string, SiteAtprotoLink>();

  private key(siteId: string, handle: string) {
    return `${siteId}\u0000${handle.trim().toLowerCase()}`;
  }

  list(siteId: string): Promise<SiteAtprotoLink[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.siteId === siteId).sort((a, b) => a.addedAt.localeCompare(b.addedAt))
    );
  }

  add(siteId: string, handle: string): Promise<SiteAtprotoLink> {
    const normalized = handle.trim().toLowerCase();
    const key = this.key(siteId, normalized);
    const existing = this.rows.get(key);
    if (existing) return Promise.resolve(existing);
    const link: SiteAtprotoLink = { siteId, handle: normalized, addedAt: new Date().toISOString() };
    this.rows.set(key, link);
    return Promise.resolve(link);
  }

  remove(siteId: string, handle: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(this.key(siteId, handle)));
  }
}
