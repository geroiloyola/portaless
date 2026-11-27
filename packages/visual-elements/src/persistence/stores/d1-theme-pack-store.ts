// Persistencia de theme packs para Cloudflare D1, server-side. Misma
// interfaz ThemePackStore. La tabla se crea via schema.sql (DDL), no en el
// constructor -- D1 no permite DDL en el constructor, igual que en
// D1ElementPackStore y D1PageStore.

import type { ThemePack } from "../../themes/theme-pack";
import { validateThemePack } from "../../themes/theme-pack";
import type { ThemePackStore } from "../theme-pack-store";

interface ThemeRow {
  name: string;
  pack_json: string;
}

export class D1ThemePackStore implements ThemePackStore {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<string[]> {
    const { results } = await this.db.prepare("SELECT name FROM theme_packs").all<{ name: string }>();
    return (results ?? []).map((r) => r.name);
  }

  async get(name: string): Promise<ThemePack | null> {
    const row = await this.db.prepare("SELECT * FROM theme_packs WHERE name = ?").bind(name).first<ThemeRow>();
    if (!row) return null;
    // Fila corrupta (JSON roto a mano o por una version vieja) = ese pack
    // no existe; no puede tumbar la carga del catalogo entero.
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
    await this.db
      .prepare(
        `INSERT INTO theme_packs (name, pack_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET pack_json = excluded.pack_json, updated_at = excluded.updated_at`
      )
      .bind(pack.name, JSON.stringify(pack), new Date().toISOString())
      .run();
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM theme_packs WHERE name = ?").bind(name).run();
    return (result?.meta?.changes ?? 0) > 0;
  }
}
