// Almacen de artefactos de plugins (Fase 11.2): troceado en BLOB, tope, hash y
// round-trip en InMemory, SQLite y D1 (fake sobre better-sqlite3).
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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
});
