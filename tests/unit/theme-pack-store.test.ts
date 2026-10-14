// packages/atomic-elements/src/persistence/theme-pack-store.ts + stores D1/
// SQLite + factory: mismo contrato que element packs. Cubre round-trip en
// los tres backends (D1 fake sobre better-sqlite3, SQLite en archivo
// temporal, InMemory), rechazo de packs invalidos al guardar, filas
// corruptas que el store oculta en get() en vez de tirar la carga
// entera, loadThemePacks, y el orden de la factory D1 -> SQLite -> memoria.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  InMemoryThemePackStore,
  loadThemePacks,
  type ThemePackStore,
} from "../../packages/atomic-elements/src/persistence/theme-pack-store";
import { D1ThemePackStore } from "../../packages/atomic-elements/src/persistence/stores/d1-theme-pack-store";
import { SqliteThemePackStore } from "../../packages/atomic-elements/src/persistence/stores/sqlite-theme-pack-store";
import { createThemePackStore } from "../../packages/atomic-elements/src/persistence/theme-pack-store-factory";
import type { ThemePack } from "../../packages/atomic-elements/src/themes/theme-pack";

const tmp = mkdtempSync(join(tmpdir(), "portaless-theme-packs-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Fake D1 local: soporta .bind(...).{run,first,all} y .all() directo. */
function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
        all: async () => ({ results: stmt.all() }),
        first: async () => stmt.get() ?? null,
      };
    },
  };
}

const DDL = `CREATE TABLE IF NOT EXISTS theme_packs (
  name TEXT PRIMARY KEY,
  pack_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const PACK: ThemePack = {
  name: "mi-tema",
  displayName: "Mi Tema",
  description: "Tema instalado de prueba",
  vars: { "--bg": "#101010", "--accent": "#FFAA00" },
};

async function roundTrip(store: ThemePackStore) {
  expect(await store.list()).toEqual([]);
  expect(await store.get("mi-tema")).toBeNull();

  await store.save(PACK);
  expect(await store.list()).toEqual(["mi-tema"]);
  const loaded = await store.get("mi-tema");
  expect(loaded?.displayName).toBe("Mi Tema");
  expect(loaded?.vars["--bg"]).toBe("#101010");

  await store.save({ ...PACK, vars: { "--bg": "#202020" } });
  expect(await store.list()).toEqual(["mi-tema"]); // upsert, no duplica
  expect((await store.get("mi-tema"))?.vars["--bg"]).toBe("#202020");

  expect(await store.remove("mi-tema")).toBe(true);
  expect(await store.remove("mi-tema")).toBe(false);
  expect(await store.list()).toEqual([]);

  await expect(store.save({ ...PACK, name: "MALO" })).rejects.toThrow(/Tema invalido/);
  await expect(store.save({ ...PACK, vars: { "--zzz": "#FFF" } })).rejects.toThrow(/Tema invalido/);
}

describe("ThemePackStore: tres backends, mismo contrato", () => {
  it("InMemory: round-trip + rechazo de invalidos", async () => {
    await roundTrip(new InMemoryThemePackStore());
  });

  it("SQLite (archivo temporal): round-trip + rechazo de invalidos", async () => {
    const store = await SqliteThemePackStore.open(join(tmp, "themes-sqlite.db"));
    await roundTrip(store);
    store.close();
  });

  it("D1 (fake sobre better-sqlite3): round-trip + rechazo de invalidos", async () => {
    const db = new Database(":memory:");
    db.exec(DDL); // D1 no permite DDL en el constructor: la tabla viene del schema
    await roundTrip(new D1ThemePackStore(fakeD1(db)));
    db.close();
  });

  it("D1: una fila corrupta (JSON roto) se oculta en get() sin tumbar el catalogo", async () => {
    const db = new Database(":memory:");
    db.exec(DDL);
    db.prepare("INSERT INTO theme_packs (name, pack_json, updated_at) VALUES (?, ?, ?)").run(
      "roto",
      "{esto no es json",
      new Date().toISOString()
    );
    db.prepare("INSERT INTO theme_packs (name, pack_json, updated_at) VALUES (?, ?, ?)").run(
      "invalido",
      JSON.stringify({ name: "invalido", displayName: "", vars: {} }),
      new Date().toISOString()
    );
    const store = new D1ThemePackStore(fakeD1(db));
    expect(await store.get("roto")).toBeNull();
    expect(await store.get("invalido")).toBeNull();
    // listado no lee el json: las dos filas siguen visibles (el filtrado
    // ocurre en get(), que es como loadThemePacks las recorre).
    expect([...(await store.list())].sort()).toEqual(["invalido", "roto"]);
    db.close();
  });

  it("factory: DB -> D1, PORTALESS_SQLITE_PATH -> SQLite, si no InMemory (sin seed)", async () => {
    const db = new Database(":memory:");
    db.exec(DDL);
    const d1 = await createThemePackStore({ DB: fakeD1(db) });
    expect(d1).toBeInstanceOf(D1ThemePackStore);

    const sqlitePath = join(tmp, "themes-factory.db");
    const sqlite = await createThemePackStore({ PORTALESS_SQLITE_PATH: sqlitePath });
    expect(sqlite).toBeInstanceOf(SqliteThemePackStore);

    const mem = await createThemePackStore({});
    expect(mem).toBeInstanceOf(InMemoryThemePackStore);
    expect(await mem.list()).toEqual([]); // los builtin NO se siembran
    db.close();
  });

  it("loadThemePacks: devuelve solo los que existen y validan", async () => {
    const store = new InMemoryThemePackStore();
    await store.save(PACK);
    const packs = await loadThemePacks(store);
    expect(packs.map((p) => p.name)).toEqual(["mi-tema"]);

    const corruptStore: ThemePackStore = {
      list: async () => ["bueno", "roto"],
      get: async (name: string) => (name === "roto" ? null : { ...PACK, name }),
      save: async () => {},
      remove: async () => false,
    };
    expect((await loadThemePacks(corruptStore)).map((p) => p.name)).toEqual(["bueno"]);
  });
});
