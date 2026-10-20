// v0.0.9.27: SqlitePageStore sobre better-sqlite3 (Node 20).
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { SqlitePageStore } from "../../packages/atomic-elements/src/persistence/stores/sqlite-page-store";
import { projectPublicRevisionHistory } from "../../packages/atomic-elements/src/persistence/public-revision-history";

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

  it("mantiene identidad estable, snapshots inmutables y rechaza un save concurrente obsoleto", async () => {
    const store = await createPageStore({ PORTALESS_SQLITE_PATH: tmpPath() });
    await store.save({ version: "0.1", slug: "historial", title: "v1", status: "published", root: [] }, { expectedRevisionId: null, actor: "admin" });
    const stale = await store.load("historial");
    const current = await store.load("historial");
    expect(current?.publicationId).toBeTruthy();
    expect(current?.revisionId).toBeTruthy();
    expect(current?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    await store.save({ ...current!, title: "v2" }, { expectedRevisionId: current!.revisionId, actor: "admin" });
    await expect(store.save({ ...stale!, title: "overwrite from stale editor" }, { expectedRevisionId: stale!.revisionId, actor: "admin" }))
      .rejects.toThrow("revision_conflict");

    const history = await store.listPublicRevisions!("historial");
    expect(history.map((revision) => revision.title)).toEqual(["v2", "v1"]);
    expect(history[0].publicationId).toBe(history[1].publicationId);
    expect(history[0].parentRevisionId).toBe(history[1].revisionId);
    expect(history[0].contentHash).not.toBe(history[1].contentHash);
    const projection = projectPublicRevisionHistory(await store.listPublicRevisionsByPublicationId!(history[0].publicationId));
    expect(projection?.format).toBe("portaless-public-revision-history/v1");
    expect(projection?.revisions[0].changedPaths).toContain("title");
    expect(projection?.revisions[0].reputation).toEqual({ status: "no_data", observations: [] });
    expect(projection?.revisions[0]).not.toHaveProperty("approvedBy");
    const sqlite = store as any;
    expect(() => sqlite.db.prepare("UPDATE page_revisions SET content_hash=content_hash WHERE revision_id=?").run(history[0].revisionId))
      .toThrow("page_revision_immutable");
    expect(() => sqlite.db.prepare("DELETE FROM page_revisions WHERE revision_id=?").run(history[0].revisionId))
      .toThrow("page_revision_immutable");

    const latest = await store.load("historial");
    await store.save({ ...latest!, status: "private", title: "private draft" }, { expectedRevisionId: latest!.revisionId });
    expect((await store.listPublicRevisions!("historial")).map((revision) => revision.title)).toEqual(["v2", "v1"]);
    expect(JSON.stringify(await store.listPublicRevisionsByPublicationId!(history[0].publicationId))).not.toContain("private draft");
  });
});
