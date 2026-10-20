import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { D1PageStore } from "../../packages/atomic-elements/src/persistence/stores/d1-page-store";
import { SqlitePageStore } from "../../packages/atomic-elements/src/persistence/stores/sqlite-page-store";
import { pageContentHash } from "../../packages/atomic-elements/src/persistence/revision-history";
import { projectPublicRevisionHistory, validatePortablePublicRevisionHistory } from "../../packages/atomic-elements/src/persistence/public-revision-history";
import { migrationSql } from "../../scripts/migrate-d1.mjs";
import { MIGRATIONS } from "../../packages/persistence-migrations/src/index";
import type { PageLayout } from "../../packages/atomic-elements/src/types";
import { AtomicElementsEditor } from "../../packages/atomic-elements/src/editor/editor-app";
import { onRequestGet as publicHistory } from "../../functions/revisions/[publicationId]/index.json.js";
import { onRequestPost as importHistory } from "../../functions/admin/api/revisions/import.js";

const connections: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of connections.splice(0)) db.close(); });
const layout = (slug = "audit"): PageLayout => ({ version: "0.1", slug, title: "v1", status: "published", root: [] });

function stores() {
  const db = new Database(":memory:");
  connections.push(db);
  db.exec(readFileSync(new URL("../../packages/atomic-elements/src/persistence/stores/schema.sql", import.meta.url), "utf8"));
  // Actual SQL semantics, including rollback and D1 meta.changes. Not a fake
  // that ignores queries: race/constraint tests exercise both real stores.
  const binding = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; },
        execute() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; },
      };
      return statement;
    },
    async batch(statements: any[]) { return db.transaction(() => statements.map((statement) => statement.execute()))(); },
  };
  return { db, sqlite: new SqlitePageStore(db), d1: new D1PageStore(binding as any) };
}

describe("C23–C25 audit regressions", () => {
  it("editor saves repeatedly and after undo using the latest persisted token", async () => {
    const { sqlite } = stores();
    vi.spyOn(AtomicElementsEditor.prototype as any, "render").mockImplementation(() => {});
    const editor = new AtomicElementsEditor({ container: {} as HTMLElement, store: sqlite, initialPage: layout() });
    await editor.save();
    (editor as any).history.push({ ...JSON.parse(editor.exportJSON()), title: "v2" });
    await editor.save();
    (editor as any).undo();
    await editor.save();
    expect((await sqlite.load("audit"))?.title).toBe("v1");
    expect(await sqlite.listPublicRevisions("audit")).toHaveLength(3);
  });

  it("a static history deployment delegates to its generated asset without creating a database", async () => {
    const next = vi.fn(async () => new Response("static history"));
    const response = await publicHistory({ env: {}, params: { publicationId: "8a0b7e78-09f3-4ad9-977b-d9fe9dbe78e5" }, next } as any);
    expect(await response.text()).toBe("static history");
    expect(next).toHaveBeenCalledOnce();
  });

  it("history import denies anonymous/viewer writes and bounds streamed bodies", async () => {
    for (const user of [null, { role: "viewer" }]) {
      const response = await importHistory({ data: { user }, env: {} } as any);
      expect(response.status).toBe(user ? 403 : 401);
    }
    const response = await importHistory({ data: { user: { role: "admin" } }, env: {}, request: new Request("https://node.example/admin/api/revisions/import", {
      method: "POST", headers: { "content-length": String(6 * 1024 * 1024) }, body: "{}",
    }) } as any);
    expect(response.status).toBe(413);
  });

  it("history remains portable after more than 100 approved revisions", async () => {
    const { sqlite } = stores();
    let head = layout();
    for (let index = 0; index < 101; index++) {
      await sqlite.save({ ...head, title: `version ${index}` });
      head = (await sqlite.load("audit"))!;
    }
    const history = projectPublicRevisionHistory(await sqlite.listPublicRevisions("audit"))!;
    await expect(stores().d1.importPublicRevisionHistory(history)).resolves.toMatchObject({ revisionId: head.revisionId });
  });
  it("D1 migration files execute every statement, including triggers", () => {
    const { db } = stores();
    for (const migration of MIGRATIONS.filter((migration) => migration.version >= 5)) {
      expect(() => db.exec(migrationSql(migration.statements))).not.toThrow();
    }
  });

  it("public hashes ignore lifecycle state and private metadata, but cover nested content", async () => {
    const original = layout();
    expect(await pageContentHash(original)).toBe(await pageContentHash({ ...original, status: "private", privateNotes: "secret" } as any));
    expect(await pageContentHash(original)).not.toBe(await pageContentHash({ ...original, root: [{ id: "x", type: "Paragraph", props: { contentHash: "real content" } }] }));
  });

  for (const backend of ["sqlite", "d1"] as const) {
    it(`${backend}: rejects stale writes and concurrent creates atomically`, async () => {
      const store = stores()[backend];
      const created = await Promise.allSettled([store.save(layout(), { expectedRevisionId: null }), store.save(layout(), { expectedRevisionId: null })]);
      expect(created.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((created.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("revision_conflict");
      const head = (await store.load("audit"))!;
      const writes = await Promise.allSettled([store.save({ ...head, title: "a" }), store.save({ ...head, title: "b" })]);
      expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await store.listPublicRevisions("audit")).toHaveLength(2);
    });

    it(`${backend}: denies private flags, isolates recreated slugs and ignores supplied identities`, async () => {
      const store = stores()[backend];
      const malicious = { ...layout(), publicationId: "../../outside", visibility: "private" } as any;
      await store.save(malicious);
      const privateHead = (await store.load("audit"))!;
      expect(privateHead.publicationId).not.toBe(malicious.publicationId);
      expect(await store.listPublicRevisions("audit")).toEqual([]);
      await store.remove("audit");
      await store.save(layout());
      const firstPublic = (await store.load("audit"))!;
      await store.remove("audit");
      await store.save(layout());
      const recreated = (await store.load("audit"))!;
      expect(recreated.publicationId).not.toBe(firstPublic.publicationId);
      expect(await store.listPublicRevisions("audit")).toHaveLength(1);
    });

    it(`${backend}: exports only public fields, supports round-trip and rejects private imports`, async () => {
      const store = stores()[backend];
      await store.save({ ...layout(), privateNotes: "PRIVATE_MARKER" } as any);
      const head = (await store.load("audit"))!;
      const history = projectPublicRevisionHistory(await store.listPublicRevisionsByPublicationId(head.publicationId!))!;
      expect(JSON.stringify(history)).not.toContain("PRIVATE_MARKER");
      await expect(validatePortablePublicRevisionHistory(history)).resolves.toBeTruthy();
      const destination = stores()[backend];
      await destination.importPublicRevisionHistory(history);
      expect((await destination.load("audit"))?.revisionId).toBe(head.revisionId);
      history.revisions[0].layout = { ...history.revisions[0].layout, visibility: "private" } as any;
      await expect(validatePortablePublicRevisionHistory(history)).rejects.toThrow("invalid_revision_history");
    });
  }
});
