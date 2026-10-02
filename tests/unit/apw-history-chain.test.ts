// APW v1.2 (B6): historial encadenado, historial de claves y rotacion.
// Los mismos casos corren contra InMemory y contra SQLite real
// (better-sqlite3 en memoria) si el driver abre.
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySiteIdentityStore, SqliteSiteIdentityStore, type SiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import {
  InMemoryAttestationLogStore,
  SqliteAttestationLogStore,
  type AttestationLogStore,
} from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation, verifyChain, sha256B64Url, type ChainKey } from "../../packages/apw-resolver/src/did-apw/history-log";
import { resolveApwHistory } from "../../packages/apw-resolver/src/did-apw/history-resolver";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import { buildApwManifest, serializeApwManifest } from "../../packages/apw-resolver/src/manifest";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";

const state = vi.hoisted(() => ({ identity: null as any, log: null as any }));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => state.identity,
  createAttestationLogStore: async () => state.log,
}));

const SITE = "default";
const DOMAIN = "ejemplo.com";
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

const toChain = (entries: Array<{ seq: number; entryJws: string }>) => entries.map((e) => ({ seq: e.seq, jws: e.entryJws }));

async function setup(b: Backend) {
  await b.identity.create(SITE, await makeKeyPair(), "admin");
  const deps = { identity: b.identity, log: b.log, siteId: SITE };
  return deps;
}

afterEach(() => {
  vi.restoreAllMocks();
  state.identity = null;
  state.log = null;
});

describe.each(backends)("historial encadenado ($name)", ({ make }) => {
  it("una cadena de 3 entradas verifica y su head es el hash de la ultima", async () => {
    const b = await make();
    const deps = await setup(b);
    for (let i = 1; i <= 3; i++) await appendAttestation(deps, fakeAttestation(i));

    const entries = await b.log.list(SITE, 1, 100);
    const keys = await b.identity.listKeys(SITE);
    const result = await verifyChain(toChain(entries), keys);

    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0].prevHash).toBeNull();
    expect(entries[1].prevHash).toBe(entries[0].entryHash);
    expect(result).toMatchObject({ valid: true, length: 3, head: entries[2].entryHash, anchoredSeq: null });
  });

  it("detecta una entrada alterada", async () => {
    const b = await make();
    const deps = await setup(b);
    for (let i = 1; i <= 3; i++) await appendAttestation(deps, fakeAttestation(i));
    const entries = toChain(await b.log.list(SITE, 1, 100));
    const keys = await b.identity.listKeys(SITE);

    const parts2 = entries[1].jws.split(".");
    const parts3 = entries[2].jws.split(".");
    entries[1] = { seq: 2, jws: `${parts2[0]}.${parts3[1]}.${parts2[2]}` };

    expect(await verifyChain(entries, keys)).toMatchObject({ valid: false, reason: "bad_signature", failedSeq: 2 });
  });

  it("detecta una entrada borrada", async () => {
    const b = await make();
    const deps = await setup(b);
    for (let i = 1; i <= 3; i++) await appendAttestation(deps, fakeAttestation(i));
    const entries = toChain(await b.log.list(SITE, 1, 100));
    const keys = await b.identity.listKeys(SITE);

    expect(await verifyChain([entries[0], entries[2]], keys)).toMatchObject({ valid: false, reason: "seq_gap", failedSeq: 2 });
  });

  it("el h del TXT ancla la cadena: detecta que se recorto la cola y acepta entradas posteriores", async () => {
    const b = await make();
    const deps = await setup(b);
    for (let i = 1; i <= 3; i++) await appendAttestation(deps, fakeAttestation(i));
    const stored = await b.log.list(SITE, 1, 100);
    const entries = toChain(stored);
    const keys = await b.identity.listKeys(SITE);

    expect(await verifyChain(entries.slice(0, 2), keys, { anchorHead: stored[2].entryHash })).toMatchObject({ valid: false, reason: "head_mismatch" });
    expect(await verifyChain(entries, keys, { anchorHead: stored[1].entryHash })).toMatchObject({ valid: true, length: 3, anchoredSeq: 2 });
    expect(await verifyChain(entries, keys, { anchorHead: stored[2].entryHash })).toMatchObject({ valid: true, anchoredSeq: 3 });
  });

  it("rotar la clave no invalida el pasado y la clave retirada pierde su privada", async () => {
    const b = await make();
    const deps = await setup(b);
    await appendAttestation(deps, fakeAttestation(1));
    await appendAttestation(deps, fakeAttestation(2));

    const oldKey = (await b.identity.listKeys(SITE))[0];
    const newPair = await makeKeyPair();
    await b.identity.rotate(SITE, newPair, "admin");
    await appendAttestation(deps, fakeAttestation(3));

    const keys = await b.identity.listKeys(SITE);
    const entries = await b.log.list(SITE, 1, 100);
    const newKid = await jwkThumbprint(newPair.publicKeyJwk);
    const active = await b.identity.getActiveSigningKey(SITE);

    expect(keys).toHaveLength(2);
    expect(keys[0].kid).toBe(oldKey.kid);
    expect(keys[0].validTo).not.toBeNull();
    expect(keys[1]).toMatchObject({ kid: newKid, validTo: null });
    expect(active?.kid).toBe(newKid);
    expect(entries.map((e) => e.kid)).toEqual([oldKey.kid, oldKey.kid, newKid]);
    expect(await verifyChain(toChain(entries), keys, { activeFingerprint: newKid })).toMatchObject({ valid: true, length: 3 });
    expect(await verifyChain(toChain(entries), keys, { activeFingerprint: oldKey.kid })).toMatchObject({ valid: false, reason: "active_key_mismatch" });
  });

  it("rotar en un sitio sin identidad lanza site_identity_not_found", async () => {
    const b = await make();
    await expect(b.identity.rotate(SITE, await makeKeyPair(), "admin")).rejects.toThrow("site_identity_not_found");
  });

  it("rechaza la misma atestacion dos veces", async () => {
    const b = await make();
    const deps = await setup(b);
    await appendAttestation(deps, fakeAttestation(1));
    await expect(appendAttestation(deps, fakeAttestation(1))).rejects.toThrow("duplicate_attestation");
    expect((await b.log.list(SITE, 1, 100)).length).toBe(1);
  });

  it("rechaza un JWS invalido y un sitio sin identidad", async () => {
    const b = await make();
    await expect(appendAttestation({ identity: b.identity, log: b.log, siteId: SITE }, fakeAttestation(1))).rejects.toThrow("site_identity_not_found");
    const deps = await setup(b);
    await expect(appendAttestation(deps, "no es un jws")).rejects.toThrow("invalid_attestation_jws");
  });

  it("escrituras simultaneas no bifurcan la cadena", async () => {
    const b = await make();
    const deps = await setup(b);
    await Promise.all([1, 2, 3].map((i) => appendAttestation(deps, fakeAttestation(i))));

    const entries = await b.log.list(SITE, 1, 100);
    const keys = await b.identity.listKeys(SITE);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await verifyChain(toChain(entries), keys)).toMatchObject({ valid: true, length: 3 });
  });
});

describe("verifyChain con cadenas armadas a mano", () => {
  it("rechaza una entrada firmada con una clave retirada y fechada despues de su ventana", async () => {
    const pair = await makeKeyPair();
    const kid = await jwkThumbprint(pair.publicKeyJwk);
    const keys: ChainKey[] = [{ kid, publicKeyJwk: pair.publicKeyJwk, validFrom: "2026-01-01T00:00:00.000Z", validTo: "2026-06-01T00:00:00.000Z" }];
    const jws = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-07-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws }], keys)).toMatchObject({ valid: false, reason: "ts_outside_key_window", failedSeq: 1 });
  });

  it("rechaza una entrada fechada antes que la anterior", async () => {
    const pair = await makeKeyPair();
    const kid = await jwkThumbprint(pair.publicKeyJwk);
    const keys: ChainKey[] = [{ kid, publicKeyJwk: pair.publicKeyJwk, validFrom: "2026-01-01T00:00:00.000Z", validTo: null }];
    const first = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);
    const second = await signRaw({ seq: 2, prev: await sha256B64Url(first), att: A43, ts: "2026-02-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws: first }, { seq: 2, jws: second }], keys)).toMatchObject({ valid: false, reason: "ts_regression", failedSeq: 2 });
  });

  it("rechaza un prev que no corresponde a la entrada anterior", async () => {
    const pair = await makeKeyPair();
    const kid = await jwkThumbprint(pair.publicKeyJwk);
    const keys: ChainKey[] = [{ kid, publicKeyJwk: pair.publicKeyJwk, validFrom: "2026-01-01T00:00:00.000Z", validTo: null }];
    const first = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, kid, pair.privateKeyJwk);
    const second = await signRaw({ seq: 2, prev: A43, att: A43, ts: "2026-03-02T00:00:00.000Z" }, kid, pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws: first }, { seq: 2, jws: second }], keys)).toMatchObject({ valid: false, reason: "prev_mismatch", failedSeq: 2 });
  });

  it("rechaza una entrada con un kid que no esta en la lista de claves", async () => {
    const pair = await makeKeyPair();
    const other = await makeKeyPair();
    const otherKid = await jwkThumbprint(other.publicKeyJwk);
    const keys: ChainKey[] = [{ kid: otherKid, publicKeyJwk: other.publicKeyJwk, validFrom: "2026-01-01T00:00:00.000Z", validTo: null }];
    const jws = await signRaw({ seq: 1, prev: null, att: A43, ts: "2026-03-01T00:00:00.000Z" }, await jwkThumbprint(pair.publicKeyJwk), pair.privateKeyJwk);

    expect(await verifyChain([{ seq: 1, jws }], keys)).toMatchObject({ valid: false, reason: "unknown_key", failedSeq: 1 });
  });

  it("rechaza una lista de claves cuyo kid no es la huella de su clave publica", async () => {
    const pair = await makeKeyPair();
    const keys: ChainKey[] = [{ kid: A43, publicKeyJwk: pair.publicKeyJwk, validFrom: "2026-01-01T00:00:00.000Z", validTo: null }];
    expect(await verifyChain([], keys)).toMatchObject({ valid: false, reason: "key_kid_mismatch" });
  });

  it("un log vacio es valido, pero no puede cumplir un h publicado", async () => {
    expect(await verifyChain([], [])).toMatchObject({ valid: true, length: 0, head: null });
    expect(await verifyChain([], [], { anchorHead: A43 })).toMatchObject({ valid: false, reason: "head_mismatch" });
  });
});

if (sqliteAvailable) {
  describe("SQLite: esquema, migracion y atomicidad", () => {
    it("borra de verdad la clave privada retirada", async () => {
      const b = (await newSqlite()) as Backend;
      await b.identity.create(SITE, await makeKeyPair(), "admin");
      await b.identity.rotate(SITE, await makeKeyPair(), "admin");

      const retired = b.db.prepare("SELECT private_key_encrypted AS p, private_key_encryption_iv AS iv FROM site_identity_keys WHERE valid_to IS NOT NULL").all();
      const active = b.db.prepare("SELECT private_key_encrypted AS p FROM site_identity_keys WHERE valid_to IS NULL").all();
      expect(retired).toHaveLength(1);
      expect(retired[0]).toEqual({ p: null, iv: null });
      expect(active).toHaveLength(1);
      expect(active[0].p).toBeTruthy();
    });

    it("copia sola la identidad que ya existia a site_identity_keys", async () => {
      const b = (await newSqlite()) as Backend;
      const pair = await makeKeyPair();
      await b.identity.create(SITE, pair, "admin");
      b.db.prepare("DELETE FROM site_identity_keys").run();

      const keys = await b.identity.listKeys(SITE);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({ kid: await jwkThumbprint(pair.publicKeyJwk), validTo: null });
      expect((await b.identity.getActiveSigningKey(SITE))?.kid).toBe(keys[0].kid);
    });

    it("la base no admite dos claves activas del mismo sitio", async () => {
      const b = (await newSqlite()) as Backend;
      await b.identity.create(SITE, await makeKeyPair(), "admin");
      const insert = () =>
        b.db
          .prepare("INSERT INTO site_identity_keys (kid, site_id, public_key_jwk, valid_from, valid_to) VALUES (?, ?, '{}', ?, NULL)")
          .run("otra-clave", SITE, new Date().toISOString());
      expect(insert).toThrow();
    });
  });
}

describe("GET /.well-known/apw-log.json y resolveApwHistory", () => {
  async function seed(entriesCount: number) {
    const identity = new InMemorySiteIdentityStore(ENV);
    const log = new InMemoryAttestationLogStore();
    state.identity = identity;
    state.log = log;
    await identity.create(SITE, await makeKeyPair(), "admin");
    const deps = { identity, log, siteId: SITE };
    for (let i = 1; i <= entriesCount; i++) await appendAttestation(deps, fakeAttestation(i));
    return { identity, log, deps };
  }

  async function callLog(path: string) {
    const { onRequestGet } = await import("../../functions/.well-known/apw-log.json.js");
    return onRequestGet({ env: {}, request: new Request(`https://${DOMAIN}${path}`) });
  }

  function fetchFor(manifest: ReturnType<typeof buildApwManifest>) {
    const txt = serializeApwManifest(manifest);
    return vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/.well-known/apw-log.json")) {
        const res = await callLog(new URL(url).pathname + new URL(url).search);
        return { ok: res.ok, status: res.status, json: async () => res.json() };
      }
      return { ok: true, json: async () => ({ Status: 0, Answer: [{ name: `_apw.${DOMAIN}.`, type: 16, TTL: 300, data: `"${txt.replace(/"/g, '\\"')}"` }] }) };
    });
  }

  it("pagina el log, publica solo claves publicas y devuelve el head", async () => {
    const { log } = await seed(3);
    const head = await log.head(SITE);

    const page1 = await (await callLog("/.well-known/apw-log.json?limit=2")).json();
    expect(page1.entries.map((e: any) => e.seq)).toEqual([1, 2]);
    expect(page1.next).toBe(3);
    expect(page1.head).toEqual({ seq: 3, hash: head?.entryHash });
    expect(page1.length).toBe(3);
    expect(page1.did).toBe(`did:apw:${DOMAIN}`);
    expect(Object.keys(page1.keys[0].publicKeyJwk).sort()).toEqual(["crv", "kty", "x"]);

    const page2 = await (await callLog("/.well-known/apw-log.json?from=3&limit=2")).json();
    expect(page2.entries.map((e: any) => e.seq)).toEqual([3]);
    expect(page2.next).toBeNull();
  });

  it("responde 404 si el sitio no tiene identidad", async () => {
    state.identity = new InMemorySiteIdentityStore(ENV);
    state.log = new InMemoryAttestationLogStore();
    expect((await callLog("/.well-known/apw-log.json")).status).toBe(404);
  });

  it("resolveApwHistory verifica contra k y h del TXT", async () => {
    const { identity, log } = await seed(3);
    const k = (await identity.getActiveSigningKey(SITE))!.kid;
    const stored = await log.list(SITE, 1, 100);

    const full = await resolveApwHistory(DOMAIN, fetchFor(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], k, h: stored[2].entryHash })) as unknown as typeof fetch);
    expect(full).toMatchObject({ verified: true, reason: "ok", length: 3, anchoredSeq: 3, unanchoredEntries: 0 });

    const stale = await resolveApwHistory(DOMAIN, fetchFor(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], k, h: stored[1].entryHash })) as unknown as typeof fetch);
    expect(stale).toMatchObject({ verified: true, anchoredSeq: 2, unanchoredEntries: 1 });
  });

  it("resolveApwHistory detecta un h que no esta en la cadena y una k que no es la activa", async () => {
    const { identity } = await seed(2);
    const k = (await identity.getActiveSigningKey(SITE))!.kid;

    const wrongHead = await resolveApwHistory(DOMAIN, fetchFor(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], k, h: A43 })) as unknown as typeof fetch);
    expect(wrongHead).toMatchObject({ verified: false, reason: "head_mismatch" });

    const wrongKey = await resolveApwHistory(DOMAIN, fetchFor(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], k: A43 })) as unknown as typeof fetch);
    expect(wrongKey).toMatchObject({ verified: false, reason: "active_key_mismatch" });
  });

  it("resolveApwHistory informa un manifiesto sin k", async () => {
    await seed(1);
    const result = await resolveApwHistory(DOMAIN, fetchFor(buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"] })) as unknown as typeof fetch);
    expect(result).toMatchObject({ verified: false, reason: "manifest_without_key" });
  });
});
