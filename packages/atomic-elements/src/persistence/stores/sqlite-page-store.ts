// Persistencia real de paginas para self-hosted (node:sqlite), server-side.
// Implementa la MISMA interfaz PageStore ya definida en
// packages/atomic-elements/src/persistence/page-store.ts (load/save/list).
// Mismo patron que packages/permissions/src/stores/sqlite-permission-store.ts.

import type { PageLayout } from "../../types";
import type { PageStore } from "../page-store";
import { validatePageLayout } from "../page-schema";

interface PageRow {
  slug: string;
  layout_json: string;
  updated_at: string;
  updated_by: string | null;
}

export class SqlitePageStore implements PageStore {
  private db: any;

  constructor(dbPath: string) {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      throw new Error("node:sqlite no esta disponible. Requiere Node 22.5+.");
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS pages (
      slug TEXT PRIMARY KEY,
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );`);
  }

  async load(slug: string): Promise<PageLayout | null> {
    const row = this.db.prepare("SELECT * FROM pages WHERE slug = ?").get(slug) as PageRow | undefined;
    return row ? (JSON.parse(row.layout_json) as PageLayout) : null;
  }

  async save(layout: PageLayout): Promise<void> {
    const result = validatePageLayout(layout);
    if (!result.valid) {
      throw new Error("Layout inv\u00e1lido: " + result.errors.join("; "));
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO pages (slug, layout_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(slug)
         DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(layout.slug, JSON.stringify(layout), updatedAt, null);
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare("SELECT slug FROM pages").all() as { slug: string }[];
    return rows.map((r) => r.slug);
  }
}
