// Almacen de artefactos de plugins (Fase 11.2): troceado en BLOB, tope, hash y
// round-trip en InMemory, SQLite y D1 (fake sobre better-sqlite3).
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyColumnMigrations } from "../../packages/persistence-migrations/src/runner";

import {
  InMemoryPluginArtifactStore,
  SqlitePluginArtifactStore,
  D1PluginArtifactStore,
  createPluginArtifactStore,
  sha256Hex,
  ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_BYTES,
} from "../../packages/plugin-sandbox/src/registry/plugin-artifacts";

const tmp = mkdtempSync(join(tmpdir(), "portaless-artifacts-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => ({ success: true, meta: { changes: Number(stmt.run(...(args as never[])).changes) } }),
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

async function roundTrip(store: any) {
  const code = bytes(ARTIFACT_CHUNK_BYTES * 2 + 100); // 3 chunks
  const meta = await store.put({ publisher: "did:apw:pub.example", name: "mi-plugin", version: "1.0.0", code });
  expect(meta.chunkCount).toBe(3);
  expect(meta.totalBytes).toBe(code.byteLength);
  expect(meta.codeHash).toHaveLength(64);

  const got = await store.get("did:apw:pub.example", "mi-plugin", "1.0.0");
  expect(got).not.toBeNull();
  expect(got!.code.byteLength).toBe(code.byteLength);
  expect(Buffer.from(got!.code).equals(Buffer.from(code))).toBe(true);

  expect(await store.getMeta("did:apw:pub.example", "mi-plugin", "1.0.0")).toMatchObject({ chunkCount: 3 });
  expect(await store.list()).toHaveLength(1);
  expect(await store.delete("did:apw:pub.example", "mi-plugin", "1.0.0")).toBe(true);
  expect(await store.get("did:apw:pub.example", "mi-plugin", "1.0.0")).toBeNull();
}

describe("PluginArtifactStore: tres backends, mismo contrato", () => {
  it("InMemory", async () => {
    await roundTrip(new InMemoryPluginArtifactStore());
  });

  it("SQLite real", async () => {
    const store = await SqlitePluginArtifactStore.open(join(tmp, "artifacts.db"));
    await roundTrip(store);
    store.close();
  });

  it("D1 (fake sobre better-sqlite3)", async () => {
    const db = new Database(join(tmp, "d1.db"));
    await roundTrip(new D1PluginArtifactStore(fakeD1(db)));
    db.close();
  });

  it("factory: DB -> D1, SQLite -> SQLite, si no InMemory", async () => {
    const db = new Database(join(tmp, "factory.db"));
    expect(await createPluginArtifactStore({ DB: fakeD1(db) })).toBeInstanceOf(D1PluginArtifactStore);
    expect(await createPluginArtifactStore({ PORTALESS_SQLITE_PATH: join(tmp, "factory-sqlite.db") })).toBeInstanceOf(SqlitePluginArtifactStore);
    expect(await createPluginArtifactStore({})).toBeInstanceOf(InMemoryPluginArtifactStore);
    db.close();
  });
});

describe("tope y validaciones", () => {
  it("rechaza publisher/name/version invalidos", async () => {
    const store = new InMemoryPluginArtifactStore();
    await expect(store.put({ publisher: "https://x", name: "p", version: "1", code: bytes(4) })).rejects.toThrow();
    await expect(store.put({ publisher: "did:apw:p.example", name: "", version: "1", code: bytes(4) })).rejects.toThrow();
    await expect(store.put({ publisher: "did:apw:p.example", name: "p", version: "", code: bytes(4) })).rejects.toThrow();
  });

  it("rechaza un artefacto vacio y uno que supera el tope", async () => {
    const store = new InMemoryPluginArtifactStore();
    await expect(store.put({ publisher: "did:apw:p.example", name: "p", version: "1", code: bytes(0) })).rejects.toThrow("empty_artifact");
    await expect(store.put({ publisher: "did:apw:p.example", name: "p", version: "1", code: bytes(MAX_ARTIFACT_BYTES + 1) })).rejects.toThrow("artifact_too_large");
  });

  it("sha256Hex es estable", async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("§14.1: el manifiesto viaja con el artefacto en los tres backends y rechaza identidad divergente", async () => {
    const manifest = {
      name: "mi-plugin",
      version: "1.0.0",
      entry: "index.js",
      runtime: "javascript" as const,
      requestedCapabilities: [{ id: "content:read" as const, reason: "lee paginas" }],
    };
    const sqliteStore = await SqlitePluginArtifactStore.open(join(tmp, "manifest-sqlite.db"));
    const d1Db = new Database(join(tmp, "manifest-d1.db"));
    const d1Store = new D1PluginArtifactStore(fakeD1(d1Db));
    const memStore = new InMemoryPluginArtifactStore();

    for (const store of [memStore, sqliteStore, d1Store]) {
      const meta = await store.put({
        publisher: "did:apw:pub.example",
        name: "mi-plugin",
        version: "1.0.0",
        code: bytes(32),
        manifest,
      });
      expect(meta.manifest).toEqual(manifest);
      const got = await store.get("did:apw:pub.example", "mi-plugin", "1.0.0");
      expect(got?.meta.manifest).toEqual(manifest);
      expect((await store.list())[0].manifest).toEqual(manifest);
    }

    await expect(
      memStore.put({
        publisher: "did:apw:pub.example",
        name: "mi-plugin",
        version: "1.0.0",
        code: bytes(8),
        manifest: { ...manifest, version: "2.0.0" },
      })
    ).rejects.toThrow("manifest_identity_mismatch");

    sqliteStore.close();
    d1Db.close();
  });

  it("§14.1: auto-migra una tabla plugin_artifacts de 7 columnas (pre-§14.1) en SQLite y D1", async () => {
    const legacyDdl =
      "CREATE TABLE plugin_artifacts (" +
      "publisher TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, " +
      "code_hash TEXT NOT NULL, total_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL, " +
      "created_at TEXT NOT NULL, PRIMARY KEY (publisher, name, version))";
    const manifest = {
      name: "legacy-p",
      version: "1.0.0",
      entry: "index.js",
      runtime: "javascript" as const,
      requestedCapabilities: [],
    };

    const sqlitePath = join(tmp, "legacy-sqlite.db");
    const preSqlite = new Database(sqlitePath);
    preSqlite.exec(legacyDdl);
    applyColumnMigrations(preSqlite); // columnas de las migraciones numeradas (base vieja)
    preSqlite.close();

    const sqliteStore = await SqlitePluginArtifactStore.open(sqlitePath);
    await sqliteStore.put({ publisher: "did:apw:pub.example", name: "legacy-p", version: "1.0.0", code: bytes(16), manifest });
    expect((await sqliteStore.getMeta("did:apw:pub.example", "legacy-p", "1.0.0"))?.manifest).toEqual(manifest);
    sqliteStore.close();

    const d1Db = new Database(join(tmp, "legacy-d1.db"));
    d1Db.exec(legacyDdl);
    applyColumnMigrations(d1Db); // la migracion v3 agrega manifest_json
    const d1Store = new D1PluginArtifactStore(fakeD1(d1Db));
    await d1Store.put({ publisher: "did:apw:pub.example", name: "legacy-p", version: "1.0.0", code: bytes(16), manifest });
    expect((await d1Store.getMeta("did:apw:pub.example", "legacy-p", "1.0.0"))?.manifest).toEqual(manifest);
    d1Db.close();
  });
});
