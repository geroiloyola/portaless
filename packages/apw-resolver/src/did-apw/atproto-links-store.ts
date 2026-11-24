// Pure APW <-> AT Protocol links port and InMemory implementation (L1).
// SQLite/D1 adapters live in `@portaless/trust-storage-adapters` (Node-L0).

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

export class InMemorySiteAtprotoLinksStore implements SiteAtprotoLinksStore {
  private rows = new Map<string, SiteAtprotoLink>();

  private key(siteId: string, handle: string) {
    return `${siteId}\u0000${handle.trim().toLowerCase()}`;
  }

  list(siteId: string): Promise<SiteAtprotoLink[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.siteId === siteId)
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
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
