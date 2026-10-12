// Store de vinculos APW <-> AT Protocol (site_atproto_links) + el campo
// alsoKnownAs del documento did:apw. Tres backends con el mismo contrato
// (D1 fake sobre better-sqlite3 + applySchema, SQLite real en archivo
// temporal, InMemory), alta idempotente, baja booleana, y el build/parse
// del documento: sin vinculos el documento sale IDENTICO al de siempre;
// con vinculos incluye alsoKnownAs; un shape corrupto invalida el
// documento completo.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../scripts/setup.mjs";
import {
  D1SiteAtprotoLinksStore,
  SqliteSiteAtprotoLinksStore,
  InMemorySiteAtprotoLinksStore,
  createSiteAtprotoLinksStore,
  LINKS_TABLE_DDL,
  type SiteAtprotoLinksStore,
} from "../../packages/apw-resolver/src/did-apw/atproto-links-store";
import { buildDidDocument, parseApwDidDocument } from "../../packages/apw-resolver/src/did-apw/document";

const tmp = mkdtempSync(join(tmpdir(), "portaless-atproto-links-"));

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

function backends(): Array<{ name: string; make: () => Promise<SiteAtprotoLinksStore> }> {
  return [
    {
      name: "D1",
      make: async () => {
        const file = join(tmp, `d1-${Math.random().toString(36).slice(2)}.db`);
        await applySchema(file, { quiet: true });
        return new D1SiteAtprotoLinksStore(fakeD1(new Database(file)) as never);
      },
    },
    {
      name: "Sqlite",
      make: async () => {
        const file = join(tmp, `sqlite-${Math.random().toString(36).slice(2)}.db`);
        await applySchema(file, { quiet: true });
        return SqliteSiteAtprotoLinksStore.open(file);
      },
    },
    { name: "InMemory", make: async () => new InMemorySiteAtprotoLinksStore() },
  ];
}

describe.each(backends())("$name SiteAtprotoLinksStore", ({ make }) => {
  it("alta idempotente, lista ordenada, baja booleana", async () => {
    const store = await make();

    const first = await store.add("default", "Username.Wikipedia.org");
    expect(first).toMatchObject({ siteId: "default", handle: "username.wikipedia.org" });

    // idempotente: la misma fila, sin duplicar
    const again = await store.add("default", "username.wikipedia.org");
    expect(again.handle).toBe(first.handle);

    await store.add("default", "jay.bsky.social");
    const links = await store.list("default");
    expect(links.map((l) => l.handle).sort()).toEqual(["jay.bsky.social", "username.wikipedia.org"]);

    // otros siteIds no se mezclan
    expect(await store.list("otro")).toEqual([]);

    expect(await store.remove("default", "USERNAME.wikipedia.org")).toBe(true);
    expect(await store.remove("default", "username.wikipedia.org")).toBe(false);
    expect((await store.list("default")).map((l) => l.handle)).toEqual(["jay.bsky.social"]);
  });
});

describe("createSiteAtprotoLinksStore (factory)", () => {
  it("elige SQLite con PORTALESS_SQLITE_PATH, D1 con env.DB, si no InMemory", async () => {
    const { createSiteAtprotoLinksStore } = await import("../../packages/apw-resolver/src/did-apw/store-factory");

    const file = join(tmp, `factory-${Math.random().toString(36).slice(2)}.db`);
    await applySchema(file, { quiet: true });
    const sqliteStore = await createSiteAtprotoLinksStore({ PORTALESS_SQLITE_PATH: file });
    expect(sqliteStore).toBeInstanceOf(SqliteSiteAtprotoLinksStore);
    await sqliteStore.add("default", "a.example.com");

    const db = new Database(file);
    const memoryStore = await createSiteAtprotoLinksStore({});
    expect(memoryStore).toBeInstanceOf(InMemorySiteAtprotoLinksStore);

    // el dato escrito por el backend SQLite esta en la base (no en memoria)
    const rows = db.prepare("SELECT handle FROM site_atproto_links WHERE site_id = ?").all("default");
    expect(rows).toEqual([{ handle: "a.example.com" }]);
    db.close();

    const d1Store = await createSiteAtprotoLinksStore({ DB: fakeD1(new Database(file)) });
    expect(d1Store).toBeInstanceOf(D1SiteAtprotoLinksStore);
  });
});

describe("buildDidDocument -- alsoKnownAs opcional", () => {
  const jwk = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
  const did = "did:apw:example.com";

  it("sin vinculos: documento identico al formato historico (sin alsoKnownAs)", () => {
    const doc = buildDidDocument(did, jwk);
    expect(doc).toEqual({
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      verificationMethod: [{ id: `${did}#key-1`, type: "Ed25519VerificationKey2020", controller: did, publicKeyJwk: jwk }],
      assertionMethod: [`${did}#key-1`],
    });
    expect("alsoKnownAs" in doc).toBe(false);
  });

  it("con vinculos: agrega tambienKnownAs de at:// y omite entradas vacias", () => {
    const doc = buildDidDocument(did, jwk, { alsoKnownAs: ["at://user.example.com", "", "at://jay.bsky.social"] });
    expect(doc.alsoKnownAs).toEqual(["at://user.example.com", "at://jay.bsky.social"]);
  });

  it("lista vacia -> sin campo (no un arreglo vacio ruidoso)", () => {
    const doc = buildDidDocument(did, jwk, { alsoKnownAs: [] });
    expect("alsoKnownAs" in doc).toBe(false);
  });
});

describe("parseApwDidDocument -- validacion de alsoKnownAs", () => {
  const base = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: "did:apw:example.com",
    verificationMethod: [
      { id: "did:apw:example.com#key-1", type: "Ed25519VerificationKey2020", controller: "did:apw:example.com", publicKeyJwk: { kty: "OKP" } },
    ],
    assertionMethod: ["did:apw:example.com#key-1"],
  };

  it("acepta documento con alsoKnownAs string[] y sin el campo", () => {
    expect(parseApwDidDocument({ ...base, alsoKnownAs: ["at://a.example.com"] })).not.toBeNull();
    expect(parseApwDidDocument(base)).not.toBeNull();
  });

  it("tambienKnownAs corrupto (no array, o con no-strings) invalida el documento entero", () => {
    expect(parseApwDidDocument({ ...base, alsoKnownAs: "at://a.example.com" })).toBeNull();
    expect(parseApwDidDocument({ ...base, alsoKnownAs: ["ok", 42] })).toBeNull();
    expect(parseApwDidDocument({ ...base, alsoKnownAs: [null] })).toBeNull();
  });

  it("el DDL exportado crea exactamente la tabla site_atproto_links", () => {
    expect(LINKS_TABLE_DDL).toContain("CREATE TABLE IF NOT EXISTS site_atproto_links");
    expect(LINKS_TABLE_DDL).toContain("PRIMARY KEY (site_id, handle)");
  });
});
