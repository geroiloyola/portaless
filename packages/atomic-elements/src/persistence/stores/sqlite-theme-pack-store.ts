// Persistencia de theme packs para self-hosted (SQLite), server-side.
// Misma interfaz ThemePackStore. Uso: const store = await SqliteThemePackStore.open(path);
//
// Sin seed: los packs builtin viven en themes/theme-pack.ts (codigo), no se
// duplican a la tabla. La tabla arranca vacia y solo recibe instalados.

import type { ThemePack } from "../../themes/theme-pack";
import { validateThemePack } from "../../themes/theme-pack";
import type { ThemePackStore } from "../theme-pack-store";
import { openSqlite } from "../../../../sqlite-driver/src/open";

interface ThemeRow {
  name: string;
  pack_json: string;
}

export class SqliteThemePackStore implements ThemePackStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteThemePackStore> {
    return new SqliteThemePackStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("Usa: await SqliteThemePackStore.open(path)");
    }
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS theme_packs (
      name TEXT PRIMARY KEY,
      pack_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare("SELECT name FROM theme_packs").all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async get(name: string): Promise<ThemePack | null> {
    const row = this.db.prepare("SELECT * FROM theme_packs WHERE name = ?").get(name) as ThemeRow | undefined;
    if (!row) return null;
    try {
      const pack = JSON.parse(row.pack_json) as ThemePack;
      const result = validateThemePack(pack);
      return result.valid && result.pack ? result.pack : null;
    } catch {
      return null;
    }
  }

  async save(pack: ThemePack): Promise<void> {
    const result = validateThemePack(pack);
    if (!result.valid) {
      throw new Error("Tema invalido: " + result.errors.join("; "));
    }
    this.db
      .prepare(
        `INSERT INTO theme_packs (name, pack_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET pack_json = excluded.pack_json, updated_at = excluded.updated_at`
      )
      .run(pack.name, JSON.stringify(pack), new Date().toISOString());
  }

  async remove(name: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM theme_packs WHERE name = ?").run(name);
    return (result?.changes ?? 0) > 0;
  }

  close(): void {
    this.db.close();
  }
}
