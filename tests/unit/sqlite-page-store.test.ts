// v0.0.9.27: SqlitePageStore sobre better-sqlite3 (Node 20).
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { SqlitePageStore } from "../../packages/atomic-elements/src/persistence/stores/sqlite-page-store";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-pages-")), "pages.db");

describe("SqlitePageStore (better-sqlite3)", () => {
  it("guarda y recupera una pagina entre instancias del store", async () => {
    const path = tmpPath();
    const a = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    await a.save({ version: "0.1", slug: "inicio", title: "Inicio", root: [{ id: "h1", type: "Heading", props: { text: "Hola" } }] });
    const b = await createPageStore({ PORTALESS_SQLITE_PATH: path });
    expect((await b.load("inicio"))?.title).toBe("Inicio");
    expect(await b.list()).toEqual(["inicio"]);
  });

  it("rechaza un layout invalido", async () => {
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: tmpPath() });
    await expect(
      store.save({ version: "0.1", slug: "x", title: "x", root: [{ id: "", type: "Heading", props: {} }] })
    ).rejects.toThrow(/Layout inv/);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqlitePageStore("/tmp/x.db" as any)).toThrow(/SqlitePageStore.open/);
  });
});
