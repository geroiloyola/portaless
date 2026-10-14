// Persistencia de element packs para self-hosted (SQLite), server-side.
// Misma interfaz ElementPackStore. Uso: const store = await SqliteElementPackStore.open(path);

import type { ElementPack } from "../../elements/element-pack";
import { validateElementPack } from "../../elements/element-pack";
import type { ElementPackStore } from "../element-pack-store";
import { demoElementPack } from "../element-pack-store";
import { openSqlite } from "../../../../sqlite-driver/src/open";
import { elementRegistry } from "../../elements/registry";

interface PackRow {
  name: string;
  pack_json: string;
}

export class SqliteElementPackStore implements ElementPackStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteElementPackStore> {
    const store = new SqliteElementPackStore(await openSqlite(dbPath));
    await store.seedIfEmpty();
    return store;
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("Usa: await SqliteElementPackStore.open(path)");
    }
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS element_packs (
      name TEXT PRIMARY KEY,
      pack_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  }

  private async seedIfEmpty(): Promise<void> {
    const count = (this.db.prepare("SELECT COUNT(*) AS c FROM element_packs").get() as { c: number }).c;
    if (count === 0) {
      const demo = demoElementPack();
      this.db
        .prepare("INSERT INTO element_packs (name, pack_json, updated_at) VALUES (?, ?, ?)")
        .run(demo.name, JSON.stringify(demo), new Date().toISOString());
    }
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare("SELECT name FROM element_packs").all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async get(name: string): Promise<ElementPack | null> {
    const row = this.db.prepare("SELECT * FROM element_packs WHERE name = ?").get(name) as PackRow | undefined;
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
    this.db
      .prepare(
        `INSERT INTO element_packs (name, pack_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET pack_json = excluded.pack_json, updated_at = excluded.updated_at`
      )
      .run(pack.name, JSON.stringify(pack), new Date().toISOString());
  }

  async remove(name: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM element_packs WHERE name = ?").run(name);
    return (result?.changes ?? 0) > 0;
  }

  close(): void {
    this.db.close();
  }
}
