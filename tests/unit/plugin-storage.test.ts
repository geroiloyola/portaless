// storage por plugin (Fase 14, §14.2): el primer backend real de capacidad.
// Contrato en los tres backends (InMemory, SQLite real, D1 fake sobre
// better-sqlite3) + cuotas + namespace por plugin + validacion de clave.
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  InMemoryPluginStorageStore,
  SqlitePluginStorageStore,
  D1PluginStorageStore,
  createPluginStorageStore,
  __resetPluginStorageStoreForTests,
  PluginStorageError,
  MAX_STORAGE_VALUE_BYTES,
  MAX_STORAGE_KEYS_PER_PLUGIN,
  MAX_STORAGE_BYTES_PER_PLUGIN,
} from "../../packages/plugin-sandbox/src/registry/plugin-storage";

const tmp = mkdtempSync(join(tmpdir(), "portaless-plugin-storage-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => __resetPluginStorageStoreForTests());

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

async function roundTrip(store: { get: any; set: any; delete: any; list: any; usage: any }) {
  expect(await store.get("mi-plugin", "k")).toBeNull();

  const saved = await store.set("mi-plugin", "k", { a: 1, nested: { ok: true } });
  expect(saved.sizeBytes).toBeGreaterThan(0);
  expect(await store.get("mi-plugin", "k")).toMatchObject({ key: "k", value: { a: 1, nested: { ok: true } } });

  await store.set("mi-plugin", "k", "actualizado");
  const updated = await store.get("mi-plugin", "k");
  expect(updated.value).toBe("actualizado");

  expect(await store.list("mi-plugin")).toEqual([{ key: "k", sizeBytes: updated.sizeBytes, updatedAt: updated.updatedAt }]);
  expect(await store.usage("mi-plugin")).toEqual({ keys: 1, bytes: updated.sizeBytes });

  expect(await store.delete("mi-plugin", "k")).toBe(true);
  expect(await store.delete("mi-plugin", "k")).toBe(false);
  expect(await store.get("mi-plugin", "k")).toBeNull();
  expect(await store.usage("mi-plugin")).toEqual({ keys: 0, bytes: 0 });
}

describe("PluginStorageStore: tres backends, mismo contrato", () => {
  it("InMemory", async () => {
    await roundTrip(new InMemoryPluginStorageStore());
  });

  it("SQLite real", async () => {
    const store = await SqlitePluginStorageStore.open(join(tmp, "storage.db"));
    await roundTrip(store);
    store.close();
  });

  it("D1 (fake sobre better-sqlite3)", async () => {
    const db = new Database(join(tmp, "d1.db"));
    await roundTrip(new D1PluginStorageStore(fakeD1(db)));
    db.close();
  });

  it("factory: DB -> D1, SQLite -> SQLite, si no InMemory (y memoria cacheada)", async () => {
    const db = new Database(join(tmp, "factory.db"));
    expect(await createPluginStorageStore({ DB: fakeD1(db) })).toBeInstanceOf(D1PluginStorageStore);
    expect(await createPluginStorageStore({ PORTALESS_SQLITE_PATH: join(tmp, "factory-sqlite.db") })).toBeInstanceOf(
      SqlitePluginStorageStore
    );
    const a = await createPluginStorageStore({});
    const b = await createPluginStorageStore({});
    expect(a).toBeInstanceOf(InMemoryPluginStorageStore);
    expect(b).toBe(a);
    db.close();
  });
});

describe("namespace por plugin: el espacio es (plugin_id, key)", () => {
  it("dos plugins con la MISMA clave no se pisan", async () => {
    const store = new InMemoryPluginStorageStore();
    await store.set("plugin-a", "config", "A");
    await store.set("plugin-b", "config", "B");
    expect((await store.get("plugin-a", "config"))?.value).toBe("A");
    expect((await store.get("plugin-b", "config"))?.value).toBe("B");
    expect(await store.usage("plugin-a")).toEqual({ keys: 1, bytes: (await store.get("plugin-a", "config"))!.sizeBytes });
  });

  it("borrar en un plugin no afecta al otro", async () => {
    const store = new InMemoryPluginStorageStore();
    await store.set("plugin-a", "k", 1);
    await store.set("plugin-b", "k", 2);
    await store.delete("plugin-a", "k");
    expect(await store.get("plugin-a", "k")).toBeNull();
    expect((await store.get("plugin-b", "k"))?.value).toBe(2);
  });
});

describe("cuotas y validacion de clave", () => {
  it("clave invalida -> STORAGE_INVALID_KEY", async () => {
    const store = new InMemoryPluginStorageStore();
    await expect(store.set("p", "clave con espacios", 1)).rejects.toBeInstanceOf(PluginStorageError);
    await expect(store.set("p", "clave con espacios", 1)).rejects.toMatchObject({ code: "STORAGE_INVALID_KEY" });
    await expect(store.set("p", "", 1)).rejects.toMatchObject({ code: "STORAGE_INVALID_KEY" });
    await expect(store.set("p", "a".repeat(257), 1)).rejects.toMatchObject({ code: "STORAGE_INVALID_KEY" });
  });

  it("valor por encima del tope -> STORAGE_VALUE_TOO_LARGE", async () => {
    const store = new InMemoryPluginStorageStore();
    // JSON.stringify agrega 2 comillas: un string de MAX-1 chars ya supera el tope.
    await expect(store.set("p", "big", "x".repeat(MAX_STORAGE_VALUE_BYTES))).rejects.toMatchObject({
      code: "STORAGE_VALUE_TOO_LARGE",
    });
    // Un valor dentro del tope si entra.
    await expect(store.set("p", "ok", "x".repeat(MAX_STORAGE_VALUE_BYTES - 2))).resolves.toBeDefined();
  });

  it("mas claves que el tope -> STORAGE_TOO_MANY_KEYS", async () => {
    const store = new InMemoryPluginStorageStore();
    for (let i = 0; i < MAX_STORAGE_KEYS_PER_PLUGIN; i++) await store.set("p", `k${i}`, i);
    await expect(store.set("p", "una-mas", 1)).rejects.toMatchObject({ code: "STORAGE_TOO_MANY_KEYS" });
    // Reemplazar una clave existente si entra (no aumenta la cantidad).
    await expect(store.set("p", "k0", "nuevo")).resolves.toBeDefined();
  });

  it("mas bytes que el tope -> STORAGE_QUOTA_EXCEEDED", async () => {
    const store = new InMemoryPluginStorageStore();
    const chunk = "x".repeat(MAX_STORAGE_VALUE_BYTES - 2); // JSON = MAX_STORAGE_VALUE_BYTES bytes
    const perPlugin = Math.floor(MAX_STORAGE_BYTES_PER_PLUGIN / MAX_STORAGE_VALUE_BYTES);
    for (let i = 0; i < perPlugin; i++) await store.set("p", `k${i}`, chunk); // llena justo el tope
    await expect(store.set("p", "una-mas", chunk)).rejects.toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });
  });
});
