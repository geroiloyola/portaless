// Persistencia de element packs para Cloudflare D1, server-side. Misma
// interfaz ElementPackStore. La tabla se crea via schema.sql (DDL), no en el
// constructor -- D1 no permite DDL en el constructor, igual que D1PageStore.

import type { ElementPack } from "../../elements/element-pack";
import { validateElementPack } from "../../elements/element-pack";
import type { ElementPackStore } from "../element-pack-store";
import { elementRegistry } from "../../elements/registry";

interface PackRow {
  name: string;
  pack_json: string;
}

export class D1ElementPackStore implements ElementPackStore {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<string[]> {
    const { results } = await this.db.prepare("SELECT name FROM element_packs").all<{ name: string }>();
    return (results ?? []).map((r) => r.name);
  }

  async get(name: string): Promise<ElementPack | null> {
    const row = await this.db.prepare("SELECT * FROM element_packs WHERE name = ?").bind(name).first<PackRow>();
    if (!row) return null;
    const pack = JSON.parse(row.pack_json) as ElementPack;
    const coreTypes = Object.keys(elementRegistry);
    return validateElementPack(pack, coreTypes).valid ? pack : null;
  }

  async save(pack: ElementPack): Promise<void> {
    const coreTypes = Object.keys(elementRegistry);
    const result = validateElementPack(pack, coreTypes);
    if (!result.valid) {
      throw new Error("Pack invalido: " + result.errors.join("; "));
    }
    await this.db
      .prepare(
        `INSERT INTO element_packs (name, pack_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET pack_json = excluded.pack_json, updated_at = excluded.updated_at`
      )
      .bind(pack.name, JSON.stringify(pack), new Date().toISOString())
      .run();
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM element_packs WHERE name = ?").bind(name).run();
    return (result?.meta?.changes ?? 0) > 0;
  }
}
