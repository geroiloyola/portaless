import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { maybeAutoEmitReaderConduct } from "../../packages/apw-resolver/src/scoring/reader-conduct-auto";
import { conductJti, periodKey } from "../../packages/apw-resolver/src/scoring/reader-conduct-config";
import {
  InMemoryReaderConductJtiStore,
  SqliteReaderConductJtiStore,
  collectEmittedJtis,
} from "../../packages/apw-resolver/src/scoring/reader-conduct-jti-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { signSiteJws, ATTESTATION_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation";
import type { AgentUsageEntry } from "../../packages/trust-layer/src/ledger/log-schema";

const SITE = "did:apw:site.example";
const READER = "did:apw:reader.example";
const OPERATOR = "thumb-reader";
const PERIOD = periodKey(new Date());

async function signer() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  const { kty, crv, x } = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as any;
  const keyId = `${SITE}#key-1`;
  return {
    pub: { kty, crv, x } as JsonWebKey,
    keyId,
    identity: {
      get: async () => ({ did: SITE }),
      getActiveSigningKey: async () => ({ keyId, privateKeyJwk: priv }),
    },
  };
}

function agent(over: Partial<AgentUsageEntry> = {}): AgentUsageEntry {
  return {
    operatorKeyId: OPERATOR,
    readerDid: READER,
    requestsTotal: 5,
    requestsCharged: 0,
    requestsFreeTier: 5,
    revenueUsd: 0,
    policyViolationsDetected: 0,
    firstSeen: "t",
    lastSeen: "t",
    ...over,
  };
}

async function makeDeps(opts: { agents?: AgentUsageEntry[]; withIdentity?: boolean; ledger?: InMemoryUsageLedgerStore } = {}) {
  const { pub, keyId, identity } = await signer();
  const log = new InMemoryAttestationLogStore();
  const ledger = opts.ledger ?? new InMemoryUsageLedgerStore();
  await ledger.put(PERIOD, {
    period: PERIOD,
    generatedAt: "t",
    agents: opts.agents ?? [agent()],
  });
  const jtiStore = new InMemoryReaderConductJtiStore();
  const deps = {
    identity: opts.withIdentity === false ? { get: async () => null, getActiveSigningKey: async () => null } : identity,
    log,
    ledger,
    jtiStore,
    resolveTxtKey: async (h: string) => (h === "reader.example" ? OPERATOR : null),
  };
  return { deps, log, jtiStore, pub, keyId };
}

describe("maybeAutoEmitReaderConduct (E-9/E-10)", () => {
  it("emite una vez desde el ledger y repetir no duplica", async () => {
    const { deps, log, pub, keyId } = await makeDeps();

    const first = await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(first?.emitted).toHaveLength(1);
    expect(first?.emitted[0]).toMatchObject({ readerDid: READER, cat: "respected_policy" });

    const entries = await log.list("default", 1, 10);
    expect(entries).toHaveLength(1);
    const v = await verifyAttestation((entries[0] as any).attJws, pub, { sub: READER, src: "reader_conduct", iss: SITE, kid: keyId });
    expect(v.ok).toBe(true);

    const second = await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(second?.emitted).toHaveLength(0);
    expect(second?.skipped[0]).toMatchObject({ reason: "already_emitted" });
    expect(await log.list("default", 1, 10)).toHaveLength(1);
  });

  it("emite policy_violation cuando el ledger registra violaciones", async () => {
    const { deps } = await makeDeps({ agents: [agent({ policyViolationsDetected: 2 })] });
    const r = await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(r?.emitted.map((e) => e.cat)).toEqual(["policy_violation"]);
  });

  it("devuelve null sin ledger, sin readerDid y sin identidad", async () => {
    const a = await makeDeps({ agents: [] });
    expect(await maybeAutoEmitReaderConduct(a.deps, OPERATOR)).toBeNull();

    const b = await makeDeps({ agents: [agent({ readerDid: undefined })] });
    expect(await maybeAutoEmitReaderConduct(b.deps, OPERATOR)).toBeNull();

    const c = await makeDeps({ withIdentity: false });
    expect(await maybeAutoEmitReaderConduct(c.deps, OPERATOR)).toBeNull();
  });

  it("respeta el indice de jtis compartido (jtiStore) sin tocar el historial", async () => {
    const { deps, log, jtiStore } = await makeDeps();
    const jti = await conductJti(SITE, READER, PERIOD, "respected_policy");
    await jtiStore.add({ siteId: "default", jti, period: PERIOD, cat: "seed", readerDid: READER, createdAt: "t" });
    const r = await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(r?.emitted).toHaveLength(0);
    expect(r?.skipped[0]).toMatchObject({ reason: "already_emitted" });
    expect(await log.list("default", 1, 10)).toHaveLength(0);
  });

  it("collectEmittedJtis reconcilia desde att_jws del historial (E-9)", async () => {
    const { deps, log } = await makeDeps();
    await maybeAutoEmitReaderConduct(deps, OPERATOR);

    const jtis = await collectEmittedJtis(log, "default", SITE);
    const jti = await conductJti(SITE, READER, PERIOD, "respected_policy");
    expect(jtis.has(jti)).toBe(true);
    expect(await new InMemoryReaderConductJtiStore().has("default", jti)).toBe(false);
  });

  it("sembrar el jtiStore desde el historial evita la doble emision en una base migrada", async () => {
    const { deps, log } = await makeDeps();
    await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(await log.list("default", 1, 10)).toHaveLength(1);

    // Simula un reinicio: el historial sobrevive, el jtiStore esta vacio.
    const freshStore = new InMemoryReaderConductJtiStore();
    (deps as any).jtiStore = freshStore;
    const r = await maybeAutoEmitReaderConduct(deps, OPERATOR);
    expect(r?.emitted).toHaveLength(0);
    expect(await log.list("default", 1, 10)).toHaveLength(1);
    // y el indice quedo sembrado para las proximas veces
    const jti = await conductJti(SITE, READER, PERIOD, "respected_policy");
    expect(await freshStore.has("default", jti)).toBe(true);
  });
});

describe("SqliteReaderConductJtiStore", () => {
  it("persiste add/has y tolera el doble add del mismo jti", async () => {
    const db = new Database(":memory:");
    const store = new SqliteReaderConductJtiStore(db);
    const record = { siteId: "default", jti: "rc-abc", period: PERIOD, cat: "respected_policy", readerDid: READER, createdAt: "t" };
    expect(await store.has("default", "rc-abc")).toBe(false);
    await store.add(record);
    expect(await store.has("default", "rc-abc")).toBe(true);
    await store.add(record);
    expect(await store.has("default", "otro")).toBe(false);
  });
});

describe("appendAttestation + witness/emit compartidos", () => {
  it("appendAttestation guarda att_jws para poder recolectar jtis (E-9)", async () => {
    const { keyId } = await signer();
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
    const log = new InMemoryAttestationLogStore();
    const identity = {
      get: async () => ({ did: SITE }),
      getActiveSigningKey: async () => ({ keyId, privateKeyJwk: priv }),
    };
    const jti = await conductJti(SITE, READER, PERIOD, "respected_policy");
    const jws = await signSiteJws(
      { typ: ATTESTATION_TYP, iss: SITE, sub: READER, src: "reader_conduct", cat: "respected_policy", val: true, iat: Math.floor(Date.now() / 1000), jti },
      { keyId, privateKeyJwk: priv },
      ATTESTATION_TYP
    );
    await appendAttestation({ identity: identity as any, log, siteId: "default" }, jws);
    const jtis = await collectEmittedJtis(log, "default", SITE);
    expect(jtis.has(jti)).toBe(true);
  });
});
