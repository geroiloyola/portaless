// APW v1.2 (ERRATA E-3): kid DID (did:apw:<dominio>#key-<n>) en los JWS del
// sitio, secuencia de claves, migracion de bases creadas por #71 y
// compatibilidad con el kid legado (huella RFC 7638). Los mismos casos corren
// contra InMemory y contra SQLite real (better-sqlite3 en memoria) si abre.
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySiteIdentityStore, SqliteSiteIdentityStore, type SiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import {
  InMemoryAttestationLogStore,
  SqliteAttestationLogStore,
  type AttestationLogStore,
} from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation, verifyChain, sha256B64Url, type ChainKey } from "../../packages/apw-resolver/src/did-apw/history-log";
import { didKeyId, isDidKeyId, parseDidKeyId } from "../../packages/apw-resolver/src/did-apw/key-id";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";

const state = vi.hoisted(() => ({ identity: null as any, log: null as any }));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => state.identity,
  createAttestationLogStore: async () => state.log,
}));

const SITE = "default";
const DOMAIN = "ejemplo.com";
const DID = `did:apw:${DOMAIN}`;
const ENV = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };
const A43 = "A".repeat(43);

const b64 = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

async function makeKeyPair(domain = DOMAIN): Promise<ApwKeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const did = `did:apw:${domain}`;
  return { did, domain, publicKeyJwk, privateKeyJwk, didDocument: buildDidDocument(did, publicKeyJwk) };
}

async function signRaw(payload: object, kid: string, privateJwk: JsonWebKey): Promise<string> {
  const header = b64(JSON.stringify({ alg: "EdDSA", kid, typ: "apw-log+jws" }));
  const body = b64(JSON.stringify(payload));
  const { kty, crv, x, d } = privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x, d } as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64(sig)}`;
}

const decodeHeader = (jws: string) => JSON.parse(Buffer.from(jws.split(".")[0], "base64url").toString());
const fakeAttestation = (n: number) => `eyJ0IjoxfQ.${b64(`att-${n}`)}.c2ln`;

interface Backend {
  identity: SiteIdentityStore;
  log: AttestationLogStore;
  db?: any;
}

const BASE_DDL = `CREATE TABLE IF NOT EXISTS site_identity (
  site_id TEXT PRIMARY KEY, did TEXT NOT NULL UNIQUE, domain TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
  private_key_jwk_encrypted TEXT NOT NULL, private_key_encryption_iv TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519', created_at TEXT NOT NULL, created_by TEXT NOT NULL)`;

async function newSqlite(): Promise<Backend | null> {
  try {
    const mod: any = await import("../../packages/sqlite-driver/src/open");
    const db = await mod.openSqlite(":memory:");
    db.exec(BASE_DDL);
    return { identity: new SqliteSiteIdentityStore(db, ENV), log: new SqliteAttestationLogStore(db), db };
  } catch {
    return null;
  }
}

const sqliteAvailable = (await newSqlite()) !== null;

const backends: Array<{ name: string; make: () => Promise<Backend> }> = [
  { name: "InMemory", make: async () => ({ identity: new InMemorySiteIdentityStore(ENV), log: new InMemoryAttestationLogStore() }) },
  ...(sqliteAvailable ? [{ name: "SQLite", make: async () => (await newSqlite()) as Backend }] : []),
];

afterEach(() => {
  vi.restoreAllMocks();
  state.identity = null;
  state.log = null;
});

describe("key-id", () => {
  it("arma y parsea did:apw:<dominio>#key-<n>", () => {
    expect(didKeyId(DID, 1)).toBe(`${DID}#key-1`);
    expect(didKeyId(DID, 12)).toBe(`${DID}#key-12`);
    expect(parseDidKeyId(`${DID}#key-12`)).toEqual({ did: DID, sequence: 12 });
    expect(isDidKeyId(`${DID}#key-1`)).toBe(true);
  });

  it("rechaza un did o una secuencia invalidos al armar", () => {
    expect(() => didKeyId(DOMAIN, 1)).toThrow("invalid_did");
    expect(() => didKeyId("did:apw:", 1)).toThrow("invalid_did");
    expect(() => didKeyId(`${DID}#key-1`, 1)).toThrow("invalid_did");
    expect(() => didKeyId(DID, 0)).toThrow("invalid_key_sequence");
    expect(() => didKeyId(DID, 1.5)).toThrow("invalid_key_sequence");
  });

  it("rechaza al parsear lo que no es un key id valido", () => {
    for (const value of [`${DID}#key-0`, `${DID}#key-01`, `${DID}#key-`, DID, "did:web:ejemplo.com#key-1", A43, 5, null, undefined]) {
      expect(parseDidKeyId(value)).toBeNull();
    }
  });
});

describe.each(backends)("kid DID en el historial ($name)", ({ make }) => {
  async function setup(b: Backend) {
    const pair = await makeKeyPair();
    await b.identity.create(SITE, pair, "admin");
    return { pair, deps: { identity: b.identity, log: b.log, siteId: SITE } };
  }

  it("la clave nueva es #key-1 y conserva su huella como kid", async () => {
    const b = await make();
    const { pair } = await setup(b);
    const [key] = await b.identity.listKeys(SITE);
    const active = await b.identity.getActiveSigningKey(SITE);

    expect(key).toMatchObject({ keyId: `${DID}#key-1`, keySequence: 1, kid: await jwkThumbprint(pair.publicKeyJwk) });
    expect(active).toMatchObject({ keyId: `${DID}#key-1`, kid: key.kid });
  });

  it("cada rotacion suma uno a la secuencia", async () => {
    const b = await make();
    await setup(b);
    await b.identity.rotate(SITE, await makeKeyPair(), "admin");
    await b.identity.rotate(SITE, await makeKeyPair(), "admin");

    const keys = await b.identity.listKeys(SITE);
    expect(keys.map((k) => k.keyId)).toEqual([`${DID}#key-1`, `${DID}#key-2`, `${DID}#key-3`]);
    expect(keys.map((k) => k.keySequence)).toEqual([1, 2, 3]);
    expect(keys.map((k) => k.validTo === null)).toEqual([false, false, true]);
    expect((await b.identity.getActiveSigningKey(SITE))?.keyId).toBe(`${DID}#key-3`);
  });

  it("las entradas nuevas firman con el keyId DID y guardan la huella en la columna kid", async () => {
    const b = await make();
    const { deps } = await setup(b);
    const entry = await appendAttestation(deps, fakeAttestation(1));
    const [key] = await b.identity.listKeys(SITE);

    expect(decodeHeader(entry.entryJws).kid).toBe(`${DID}#key-1`);
    expect(entry.kid).toBe(key.kid);
  });

  it("la cadena verifica a traves de una rotacion y cada entrada usa el keyId de su clave", async () => {
    const b = await make();
    const { deps } = await setup(b);
    await appendAttestation(deps, fakeAttestation(1));
    await b.identity.rotate(SITE, await makeKeyPair(), "admin");
    await appendAttestation(deps, fakeAttestation(2));

    const stored = await b.log.list(SITE, 1, 100);
    const keys = await b.identity.listKeys(SITE);
    const result = await verifyChain(
      stored.map((e) => ({ seq: e.seq, jws: e.entryJws })),
      keys,
      { expectedDid: DID, activeFingerprint: keys[1].kid }
    );

    expect(stored.map((e) => decodeHeader(e.entryJws).kid)).toEqual([`${DID}#key-1`, `${DID}#key-2`]);
    expect(result).toMatchObject({ valid: true, length: 2 });
  });
});

describe("verifyChain: kid DID y kid legado", () => {
  const FROM = "2026-01-01T00:00:00.000Z";

  async function setup() {
    const pair = await makeKeyPair();
    const kid = await jwkThumbprint(pair.publicKeyJwk);
    const keyId = didKeyId(DID, 1);
    const keys: ChainKey[] = [{ kid, keyId, publicKeyJwk: pair.publicKeyJwk, validFrom: FROM, validTo: null }];
    return { pair, kid, keyId, keys };
  }

  it("acepta una entrada firmada con el keyId DID y otra con la huella (entradas de #71)", async () => {
    const { pair, kid, keyId, keys } = await setup();
    const legacy = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);
    const modern = await signRaw({ seq: 2, prev: await sha256B64Url(legacy), att: A43, ts: "2026-04-01T00:00:00.000Z" }, keyId, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws: legacy }], keys, { expectedDid: DID })).toMatchObject({ valid: true });
    expect(await verifyChain([{ seq: 1, jws: legacy }, { seq: 2, jws: modern }], keys, { expectedDid: DID })).toMatchObject({
      valid: true,
      length: 2,
    });
  });

  it("un documento anterior a E-3, sin keyId, sigue verificando por la huella", async () => {
    const { pair, kid } = await setup();
    const keys: ChainKey[] = [{ kid, publicKeyJwk: pair.publicKeyJwk, validFrom: FROM, validTo: null }];
    const legacy = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws: legacy }], keys, { expectedDid: DID })).toMatchObject({ valid: true });
  });

  it("una entrada con keyId DID no verifica si la lista de claves no lo publica", async () => {
    const { pair, kid, keyId } = await setup();
    const keys: ChainKey[] = [{ kid, publicKeyJwk: pair.publicKeyJwk, validFrom: FROM, validTo: null }];
    const modern = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, keyId, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws: modern }], keys)).toMatchObject({ valid: false, reason: "unknown_key", failedSeq: 1 });
  });

  it("rechaza un keyId de otro dominio, uno mal formado y uno repetido", async () => {
    const { pair, kid, keys } = await setup();

    expect(await verifyChain([], keys, { expectedDid: "did:apw:otro.com" })).toMatchObject({ valid: false, reason: "key_kid_mismatch" });

    const malFormado: ChainKey[] = [{ ...keys[0], keyId: "no-es-un-key-id" }];
    expect(await verifyChain([], malFormado)).toMatchObject({ valid: false, reason: "key_kid_mismatch" });

    const otra = await makeKeyPair();
    const repetido: ChainKey[] = [
      keys[0],
      { kid: await jwkThumbprint(otra.publicKeyJwk), keyId: keys[0].keyId, publicKeyJwk: otra.publicKeyJwk, validFrom: FROM, validTo: null },
    ];
    expect(await verifyChain([], repetido)).toMatchObject({ valid: false, reason: "key_kid_mismatch" });

    const keyIdIgualAHuellaAjena: ChainKey[] = [
      keys[0],
      { kid: await jwkThumbprint(otra.publicKeyJwk), keyId: kid, publicKeyJwk: otra.publicKeyJwk, validFrom: FROM, validTo: null },
    ];
    expect(await verifyChain([], keyIdIgualAHuellaAjena)).toMatchObject({ valid: false, reason: "key_kid_mismatch" });
    expect(pair).toBeTruthy();
  });
});

if (sqliteAvailable) {
  describe("SQLite: migracion de bases creadas por #71", () => {
    const OLD_KEYS_DDL = `CREATE TABLE site_identity_keys (
      kid TEXT PRIMARY KEY, site_id TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
      private_key_encrypted TEXT, private_key_encryption_iv TEXT,
      key_algorithm TEXT NOT NULL DEFAULT 'ed25519', valid_from TEXT NOT NULL, valid_to TEXT);
      CREATE UNIQUE INDEX idx_site_identity_keys_active ON site_identity_keys(site_id) WHERE valid_to IS NULL;`;

    it("agrega las columnas y asigna #key-1, #key-2 por fecha de alta", async () => {
      const b = (await newSqlite()) as Backend;
      const oldPair = await makeKeyPair();
      const currentPair = await makeKeyPair();
      const oldKid = await jwkThumbprint(oldPair.publicKeyJwk);
      const currentKid = await jwkThumbprint(currentPair.publicKeyJwk);

      b.db.exec(OLD_KEYS_DDL);
      b.db
        .prepare("INSERT INTO site_identity (site_id, did, domain, public_key_jwk, private_key_jwk_encrypted, private_key_encryption_iv, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(SITE, DID, DOMAIN, JSON.stringify(currentPair.publicKeyJwk), "x", "y", "2026-02-01T00:00:00.000Z", "admin");
      const insertKey = b.db.prepare(
        "INSERT INTO site_identity_keys (kid, site_id, public_key_jwk, private_key_encrypted, private_key_encryption_iv, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      insertKey.run(currentKid, SITE, JSON.stringify(currentPair.publicKeyJwk), "x", "y", "2026-02-01T00:00:00.000Z", null);
      insertKey.run(oldKid, SITE, JSON.stringify(oldPair.publicKeyJwk), null, null, "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");

      const keys = await b.identity.listKeys(SITE);
      expect(keys.map((k) => [k.kid, k.keyId, k.keySequence])).toEqual([
        [oldKid, `${DID}#key-1`, 1],
        [currentKid, `${DID}#key-2`, 2],
      ]);

      await b.identity.rotate(SITE, await makeKeyPair(), "admin");
      const afterRotate = await b.identity.listKeys(SITE);
      expect(afterRotate.map((k) => k.keyId)).toEqual([`${DID}#key-1`, `${DID}#key-2`, `${DID}#key-3`]);
    });

    it("la base no admite dos claves con la misma secuencia", async () => {
      const b = (await newSqlite()) as Backend;
      await b.identity.create(SITE, await makeKeyPair(), "admin");
      const insert = () =>
        b.db
          .prepare("INSERT INTO site_identity_keys (kid, site_id, public_key_jwk, valid_from, valid_to, key_id, key_sequence) VALUES (?, ?, '{}', ?, ?, ?, 1)")
          .run("retirada", SITE, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", `${DID}#key-9`);
      expect(insert).toThrow();
    });
  });
}

describe("GET /.well-known/apw-log.json publica keyId y fingerprint", () => {
  it("cada clave trae keyId, keySequence, fingerprint y el alias kid, solo con miembros publicos", async () => {
    const identity = new InMemorySiteIdentityStore(ENV);
    const log = new InMemoryAttestationLogStore();
    state.identity = identity;
    state.log = log;
    const pair = await makeKeyPair();
    await identity.create(SITE, pair, "admin");
    await identity.rotate(SITE, await makeKeyPair(), "admin");
    await appendAttestation({ identity, log, siteId: SITE }, fakeAttestation(1));

    const { onRequestGet } = await import("../../functions/.well-known/apw-log.json.js");
    const res = await onRequestGet({ env: {}, request: new Request(`https://${DOMAIN}/.well-known/apw-log.json`) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0]).toMatchObject({ keyId: `${DID}#key-1`, keySequence: 1, fingerprint: await jwkThumbprint(pair.publicKeyJwk) });
    expect(body.keys[0].kid).toBe(body.keys[0].fingerprint);
    expect(body.keys[1]).toMatchObject({ keyId: `${DID}#key-2`, keySequence: 2, validTo: null });
    expect(Object.keys(body.keys[0].publicKeyJwk).sort()).toEqual(["crv", "kty", "x"]);
    expect(decodeHeader(body.entries[0].jws).kid).toBe(`${DID}#key-2`);
  });
});
