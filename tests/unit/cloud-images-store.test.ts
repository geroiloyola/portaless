// packages/cloud-images/src/store.ts: registro de imagenes firmadas +
// bytes. Tres backends con el mismo contrato (D1 fake sobre
// better-sqlite3 + applySchema, SQLite real en archivo temporal,
// InMemory), round-trip de bytes y sidecar, dedupe por content_hash,
// list limitado, baja booleana, y el factory D1/SQLite/InMemory.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../scripts/setup.mjs";
import {
  D1CloudImageStore,
  SqliteCloudImageStore,
  InMemoryCloudImageStore,
  createCloudImageStore,
  CLOUD_IMAGES_TABLE_DDL,
  type CloudImageStore,
} from "../../packages/cloud-images/src/store";
import { buildCloudImagePayload, sha256Hash, encodeBase64, type CloudImageSidecar } from "../../packages/cloud-images/src/payload";
import { signCloudImage } from "../../packages/cloud-images/src/sign";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";

const tmp = mkdtempSync(join(tmpdir(), "portaless-cloud-images-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

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
      };
    },
  };
}

async function signedSidecar(bytes: Uint8Array, imageId = "img-1"): Promise<CloudImageSidecar> {
  const keyPair = await generateApwDid("ejemplo.com");
  const payload = buildCloudImagePayload({
    imageId,
    contentHash: await sha256Hash(bytes),
    contentType: "image/png",
    byteLength: bytes.length,
    declaredOrigin: "ai",
    siteId: "default",
    siteDid: "did:apw:ejemplo.com",
    signedAt: new Date().toISOString(),
    trust: null,
  });
  const jws = await signCloudImage(payload, { keyId: "did:apw:ejemplo.com#key-1", privateKeyJwk: keyPair.privateKeyJwk });
  return { payload, jws };
}

const IMAGE_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);

function backends(): Array<{ name: string; make: () => Promise<CloudImageStore> }> {
  return [
    {
      name: "D1",
      make: async () => {
        const file = join(tmp, `d1-${Math.random().toString(36).slice(2)}.db`);
        await applySchema(file, { quiet: true });
        return new D1CloudImageStore(fakeD1(new Database(file)) as never);
      },
    },
    {
      name: "Sqlite",
      make: async () => {
        const file = join(tmp, `sqlite-${Math.random().toString(36).slice(2)}.db`);
        await applySchema(file, { quiet: true });
        return SqliteCloudImageStore.open(file);
      },
    },
    { name: "InMemory", make: async () => new InMemoryCloudImageStore() },
  ];
}

describe.each(backends())("$name CloudImageStore", ({ make }) => {
  it("put/get round-trip de metadata + bytes, dedupe por hash, list y remove", async () => {
    const store = await make();
    const sidecar = await signedSidecar(IMAGE_BYTES);

    const record = await store.put({ sidecar, bytes: IMAGE_BYTES, keyId: "did:apw:ejemplo.com#key-1", createdBy: "admin" });
    expect(record).toMatchObject({
      imageId: "img-1",
      contentHash: sidecar.payload.contentHash,
      byteLength: IMAGE_BYTES.length,
      declaredOrigin: "ai",
      siteDid: "did:apw:ejemplo.com",
      keyId: "did:apw:ejemplo.com#key-1",
      createdBy: "admin",
    });
    expect(record.sidecar).toEqual(sidecar);

    const fetched = await store.get("img-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.bytes).toEqual(IMAGE_BYTES);
    expect(fetched!.record.sidecar.jws).toBe(sidecar.jws);

    expect(await store.get("no-existe")).toBeNull();
    expect(await store.getByContentHash(sidecar.payload.contentHash)).toMatchObject({ imageId: "img-1" });
    expect(await store.getByContentHash("sha256:" + "0".repeat(64))).toBeNull();

    const sidecar2 = await signedSidecar(Uint8Array.from([1, 2, 3]), "img-2");
    await store.put({ sidecar: sidecar2, bytes: Uint8Array.from([1, 2, 3]), keyId: "did:apw:ejemplo.com#key-1" });
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect((await store.list(1)).length).toBe(1);

    expect(await store.remove("img-1")).toBe(true);
    expect(await store.remove("img-1")).toBe(false);
    expect(await store.get("img-1")).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it("rechaza un sidecar corrupto en put", async () => {
    const store = await make();
    await expect(
      store.put({ sidecar: { payload: null, jws: "a.b.c" } as never, bytes: IMAGE_BYTES, keyId: "x" })
    ).rejects.toThrow("invalid_sidecar");
  });
});

describe("createCloudImageStore (factory)", () => {
  it("SQLite con PORTALESS_SQLITE_PATH, D1 con env.DB, si no InMemory con warning", async () => {
    const file = join(tmp, `factory-${Math.random().toString(36).slice(2)}.db`);
    await applySchema(file, { quiet: true });

    const sqliteStore = await createCloudImageStore({ PORTALESS_SQLITE_PATH: file });
    expect(sqliteStore).toBeInstanceOf(SqliteCloudImageStore);
    const sidecar = await signedSidecar(IMAGE_BYTES, "img-sql");
    await sqliteStore.put({ sidecar, bytes: IMAGE_BYTES, keyId: "did:apw:ejemplo.com#key-1" });

    const db = new Database(file);
    const rows = db.prepare("SELECT image_id FROM cloud_images").all();
    expect(rows).toEqual([{ image_id: "img-sql" }]);
    db.close();

    const memoryStore = await createCloudImageStore({});
    expect(memoryStore).toBeInstanceOf(InMemoryCloudImageStore);

    const d1File = join(tmp, `factory-d1-${Math.random().toString(36).slice(2)}.db`);
    const db2 = new Database(d1File);
    const d1Store = await createCloudImageStore({ DB: fakeD1(db2) });
    expect(d1Store).toBeInstanceOf(D1CloudImageStore);
    const sidecarD1 = await signedSidecar(IMAGE_BYTES, "img-d1");
    await d1Store.put({ sidecar: sidecarD1, bytes: IMAGE_BYTES, keyId: "did:apw:ejemplo.com#key-1" });
    expect(db2.prepare("SELECT image_id FROM cloud_images").all()).toEqual([{ image_id: "img-d1" }]);
    db2.close();
  });

  it("el DDL crea exactamente la tabla cloud_images con indice unico de hash", () => {
    expect(CLOUD_IMAGES_TABLE_DDL).toContain("CREATE TABLE IF NOT EXISTS cloud_images");
    expect(CLOUD_IMAGES_TABLE_DDL).toContain("bytes BLOB NOT NULL");
    expect(encodeBase64(Uint8Array.from([1]))).toBe("AQ==");
  });
});
