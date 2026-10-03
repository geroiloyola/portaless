import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { InMemoryUsageLedgerStore, recordAgentAccess } from "../../packages/trust-layer/src/ledger/log-writer";
import { SqliteUsageLedgerStore } from "../../packages/trust-layer/src/ledger/sqlite-log-store";
import type { UsageLogPeriod } from "../../packages/trust-layer/src/ledger/log-schema";
import { emitReaderConduct } from "../../packages/apw-resolver/src/scoring/reader-conduct-emitter";
import { signSiteJws, ATTESTATION_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation";

const SITE = "did:apw:site.example";
const READER = "did:apw:reader.example";

describe("ledger readerDid (E-9)", () => {
  it("recordAgentAccess fija readerDid la primera vez y no lo pisa", async () => {
    const store = new InMemoryUsageLedgerStore();
    await recordAgentAccess(store, { operatorKeyId: "k1", readerDid: READER, charged: false, amountUsd: 0 });
    await recordAgentAccess(store, { operatorKeyId: "k1", readerDid: "did:apw:otro.example", charged: false, amountUsd: 0 });
    await recordAgentAccess(store, { operatorKeyId: "k2", charged: false, amountUsd: 0 });
    const period = (await store.get(new Date().toISOString().slice(0, 7)))!;
    expect(period.agents.find((a) => a.operatorKeyId === "k1")).toMatchObject({ readerDid: READER, requestsTotal: 2 });
    expect(period.agents.find((a) => a.operatorKeyId === "k2")?.readerDid).toBeUndefined();
  });

  it("SQLite: migra una base sin reader_did, persiste y no pisa el valor", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE usage_ledger (
      period TEXT NOT NULL, operator_key_id TEXT NOT NULL, operator_name_claimed TEXT,
      requests_total INTEGER NOT NULL DEFAULT 0, requests_charged INTEGER NOT NULL DEFAULT 0,
      requests_free_tier INTEGER NOT NULL DEFAULT 0, revenue_usd REAL NOT NULL DEFAULT 0,
      policy_violations_detected INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      PRIMARY KEY (period, operator_key_id));`);
    db.prepare("INSERT INTO usage_ledger VALUES ('2026-09','old',NULL,3,0,3,0,0,'t','t')").run();
    const store = new SqliteUsageLedgerStore(db);
    const before = await store.get("2026-09");
    expect(before?.agents[0]).toMatchObject({ operatorKeyId: "old", requestsTotal: 3 });
    expect(before?.agents[0].readerDid).toBeUndefined();

    const entry = { operatorKeyId: "k1", readerDid: READER, requestsTotal: 1, requestsCharged: 0, requestsFreeTier: 1, revenueUsd: 0, policyViolationsDetected: 0, firstSeen: "t", lastSeen: "t" };
    await store.put("2026-10", { period: "2026-10", generatedAt: "t", agents: [entry] });
    await store.put("2026-10", { period: "2026-10", generatedAt: "t", agents: [{ ...entry, readerDid: undefined, requestsTotal: 2 }] });
    expect((await store.get("2026-10"))?.agents[0]).toMatchObject({ readerDid: READER, requestsTotal: 2 });
  });
});

async function signer() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  const { kty, crv, x } = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as any;
  const keyId = `${SITE}#key-1`;
  return {
    pub: { kty, crv, x } as JsonWebKey,
    keyId,
    s: { did: SITE, sign: (p: Record<string, unknown>) => signSiteJws(p, { keyId, privateKeyJwk: priv }, ATTESTATION_TYP) },
  };
}

function period(agents: Array<Partial<UsageLogPeriod["agents"][number]> & { operatorKeyId: string }>): UsageLogPeriod {
  return {
    period: "2026-09",
    generatedAt: "t",
    agents: agents.map((a) => ({ requestsTotal: 5, requestsCharged: 0, requestsFreeTier: 5, revenueUsd: 0, policyViolationsDetected: 0, firstSeen: "t", lastSeen: "t", ...a })),
  };
}

describe("emitReaderConduct (E-9)", () => {
  it("emite respected_policy firmada, verificable y con jti determinista; repetir no duplica", async () => {
    const { s, pub, keyId } = await signer();
    const saved = new Map<string, string>();
    const deps = {
      signer: s,
      resolveTxtKey: async (h: string) => (h === "reader.example" ? "thumb-1" : null),
      alreadyEmitted: async (jti: string) => saved.has(jti),
      record: async (jws: string, jti: string) => { saved.set(jti, jws); },
    };
    const p = period([{ operatorKeyId: "thumb-1", readerDid: READER }]);
    const first = await emitReaderConduct(p, deps);
    expect(first.emitted).toHaveLength(1);
    expect(first.emitted[0]).toMatchObject({ readerDid: READER, cat: "respected_policy" });
    const jws = saved.get(first.emitted[0].jti)!;
    const v = await verifyAttestation(jws, pub, { sub: READER, src: "reader_conduct", iss: SITE, kid: keyId });
    expect(v.ok).toBe(true);

    const second = await emitReaderConduct(p, deps);
    expect(second.emitted).toHaveLength(0);
    expect(second.skipped[0]).toMatchObject({ reason: "already_emitted", cat: "respected_policy" });
  });

  it("una violacion emite policy_violation y no respected_policy", async () => {
    const { s } = await signer();
    const r = await emitReaderConduct(period([{ operatorKeyId: "thumb-1", readerDid: READER, policyViolationsDetected: 1 }]), {
      signer: s,
      resolveTxtKey: async () => "thumb-1",
      alreadyEmitted: async () => false,
      record: async () => {},
    });
    expect(r.emitted.map((e) => e.cat)).toEqual(["policy_violation"]);
  });

  it("no emite sin readerDid, para si mismo, sin TXT ni con una clave que no es k", async () => {
    const { s } = await signer();
    const r = await emitReaderConduct(
      period([
        { operatorKeyId: "a" },
        { operatorKeyId: "b", readerDid: SITE },
        { operatorKeyId: "c", readerDid: "did:apw:sin-apw.example" },
        { operatorKeyId: "impostor", readerDid: READER },
      ]),
      {
        signer: s,
        resolveTxtKey: async (h: string) => (h === "reader.example" ? "thumb-1" : null),
        alreadyEmitted: async () => false,
        record: async () => { throw new Error("no deberia emitir"); },
      }
    );
    expect(r.emitted).toHaveLength(0);
    expect(r.skipped.map((x) => x.reason)).toEqual(["no_reader_did", "self", "reader_without_apw", "key_not_bound_to_apw"]);
  });
});
