// Persistencia real de paginas para Cloudflare D1 (server-side).
// Implementa la MISMA interfaz PageStore ya definida en
// packages/atomic-elements/src/persistence/page-store.ts (load/save/list),
// para que endpoints como functions/admin/pages/[slug].js puedan usar esta
// implementacion o LocalStoragePageStore de forma intercambiable.
// Mismo patron que packages/permissions/src/stores/d1-permission-store.ts.

import type { PageLayout } from "../../types";
import type { PageStore } from "../page-store";
import { validatePageLayout } from "../page-schema";

interface PageRow {
  slug: string;
  layout_json: string;
  updated_at: string;
  updated_by: string | null;
}

export class D1PageStore implements PageStore {
  constructor(private readonly db: D1Database) {}

  async load(slug: string): Promise<PageLayout | null> {
    const row = await this.db
      .prepare("SELECT * FROM pages WHERE slug = ?")
      .bind(slug)
      .first<PageRow>();
    return row ? (JSON.parse(row.layout_json) as PageLayout) : null;
  }

  async save(layout: PageLayout): Promise<void> {
    const result = validatePageLayout(layout);
    if (!result.valid) {
      throw new Error("Layout inv\u00e1lido: " + result.errors.join("; "));
    }
    const updatedAt = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO pages (slug, layout_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(slug)
         DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .bind(layout.slug, JSON.stringify(layout), updatedAt, null)
      .run();
  }

  async list(): Promise<string[]> {
    const { results } = await this.db.prepare("SELECT slug FROM pages").all<{ slug: string }>();
    return (results ?? []).map((r) => r.slug);
  }
}
