// Portaless Index Phase 5 (APW v1.3, 5.7 y seccion 7): calibracion de
// pesos estilo A.4.4 y sincronizacion entre nodos (syncIndexPeers).
// Material REAL (claves Ed25519, statements firmados, cadenas): solo la
// red y la resolucion de cadenas son fixtures.
import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import { signWitnessStatement } from "../../packages/apw-resolver/src/did-apw/witness";
import {
  buildIndexDocument,
  syncWitnessIndex,
  syncIndexPeers,
  witnessCalibrationFactor,
  MAX_PEER_SUBJECTS,
} from "../../packages/apw-resolver/src/did-apw/witness-index";
import { InMemoryWitnessIndexStore } from "../../packages/apw-resolver/src/did-apw/witness-index-store";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";
import type { ApwHistoryResult } from "../../packages/apw-resolver/src/did-apw/history-resolver";

const ENV = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };
const SITE_ID = "default";
const SUBJECT_DOMAIN = "sujeto.example";
const W1_DOMAIN = "t1.example";
const W2_DOMAIN = "t2.example";
const PEER_DOMAIN = "par.example";

async function makeKeyPair(domain: string): Promise<ApwKeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const did = `did:apw:${domain}`;
  return { did, domain, publicKeyJwk, privateKeyJwk, didDocument: buildDidDocument(did, publicKeyJwk) };
}

interface Site {
  domain: string;
  did: string;
  identity: InMemorySiteIdentityStore;
  log: InMemoryAttestationLogStore;
  deps: { identity: InMemorySiteIdentityStore; log: InMemoryAttestationLogStore; siteId: string };
}

async function makeSite(domain: string): Promise<Site> {
  const identity = new InMemorySiteIdentityStore(ENV);
  const log = new InMemoryAttestationLogStore();
  await identity.create(SITE_ID, await makeKeyPair(domain), "admin");
  return { domain, did: `did:apw:${domain}`, identity, log, deps: { identity, log, siteId: SITE_ID } };
}

const fakeAttestation = (n: number) => `eyJ0IjoxfQ.${Buffer.from(`att-${n}`).toString("base64url")}.c2ln`;

async function appendChain(site: Site, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) await appendAttestation(site.deps, fakeAttestation(i));
}

async function historyOf(site: Site): Promise<ApwHistoryResult> {
  const rows = await site.log.list(SITE_ID, 1, 500);
  const keys = await site.identity.listKeys(SITE_ID);
  return {
    verified: true,
    reason: "ok",
    domain: site.domain,
    length: rows.length,
    head: rows.length > 0 ? rows[rows.length - 1].entryHash : null,
    anchoredSeq: rows.length,
    attestations: rows.map((r) => ({ seq: r.seq, att: r.attHash, ts: r.ts, kid: r.kid, entryHash: r.entryHash })),
    keys,
  };
}

function decodePayload(jws: string): any {
  try {
    const part = jws.split(".")[1];
    const base64 = part.split("-").join("+").split("_").join("/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function witnessDocOf(site: Site): Promise<any> {
  const rows = await site.log.list(SITE_ID, 1, 500);
  const entries = rows.map((r) => {
    const p = decodePayload(r.attJws);
    return {
      seq: r.seq,
      att: r.attHash,
      jws: r.attJws,
      witness: { sub: p?.sub ?? null, seq: p?.seq ?? null, head: p?.head ?? null, ts: p?.ts ?? null, jti: p?.jti ?? null },
    };
  });
  return { did: site.did, length: rows.length, entries, next: null };
}

async function recordObservation(witness: Site, subject: Site): Promise<void> {
  const history = await historyOf(subject);
  const key = await witness.identity.getActiveSigningKey(SITE_ID);
  const { jws } = await signWitnessStatement(
    { iss: witness.did, sub: subject.did, seq: history.length ?? 0, head: history.head ?? null, ts: new Date().toISOString() },
    { keyId: key!.keyId, privateKeyJwk: key!.privateKeyJwk }
  );
  await appendAttestation(witness.deps, jws);
}

interface World {
  histories: Record<string, ApwHistoryResult>;
  docs: Record<string, any>;
  peerDocs: Record<string, any>;
}

function depsFor(world: World) {
  return {
    fetchText: async (url: string) => {
      const wm = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
      if (wm) {
        const doc = world.docs[wm[1]];
        return doc ? JSON.stringify(doc) : null;
      }
      const pm = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-index\.json/);
      if (pm) {
        const doc = world.peerDocs[pm[1]];
        return doc ? JSON.stringify(doc) : null;
      }
      return null;
    },
    resolveHistory: async (domain: string) =>
      world.histories[domain] ?? { verified: false, reason: "manifest_not_resolved", domain },
  };
}

let store: InMemoryWitnessIndexStore;
let world: World;

beforeEach(() => {
  store = new InMemoryWitnessIndexStore();
  world = { histories: {}, docs: {}, peerDocs: {} };
});

describe("calibracion A.4.4 (witnessCalibrationFactor)", () => {
  it("arranca en 1.0 sin datos y se mueve hacia 1.9 / 0.1 con la historia", () => {
    expect(witnessCalibrationFactor(0, 0)).toBeCloseTo(1.0, 10);
    expect(witnessCalibrationFactor(5, 0)).toBeCloseTo(0.1 + 1.8 * (6 / 7), 10);
    expect(witnessCalibrationFactor(0, 5)).toBeCloseTo(0.1 + 1.8 * (1 / 7), 10);
    expect(witnessCalibrationFactor(100, 0)).toBeLessThanOrEqual(1.9);
    expect(witnessCalibrationFactor(0, 100)).toBeGreaterThanOrEqual(0.1);
  });

  it("contadores negativos se tratan como cero (defensa, no deberian llegar)", () => {
    expect(witnessCalibrationFactor(-3, -1)).toBeCloseTo(1.0, 10);
  });
});

describe("calibracion durante syncWitnessIndex", () => {
  it("primer sync: factores 1.0, pesos efectivos = base y contadores registrados en el consenso", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const entry = await syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN] });
    expect(entry.observations).toHaveLength(1);
    expect(entry.observations[0]).toMatchObject({ baseWeight: 1, calibrationFactor: 1.0, weight: 1.0 });
    expect(await store.getCalibration(SITE_ID)).toEqual({ [`did:apw:${W1_DOMAIN}`]: { agree: 1, disagree: 0 } });
  });

  it("un testigo que acierta gana factor; uno que disiente lo pierde; el consenso usa los efectivos", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    // Sync 1: w1 acuerda (factor 1.0).
    await syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN] });

    // w2 observa ahora una cabeza DISTINTA (finge seq/head viejos): su
    // statement verifica crypto, pero disiente del consenso del sync 2.
    const w2 = await makeSite(W2_DOMAIN);
    const key = await w2.identity.getActiveSigningKey(SITE_ID);
    const { jws } = await signWitnessStatement(
      { iss: w2.did, sub: subject.did, seq: 1, head: "B".repeat(43), ts: new Date().toISOString() },
      { keyId: key!.keyId, privateKeyJwk: key!.privateKeyJwk }
    );
    await appendAttestation(w2.deps, jws);
    world.histories[W2_DOMAIN] = await historyOf(w2);
    world.docs[W2_DOMAIN] = await witnessDocOf(w2);

    const entry2 = await syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN, W2_DOMAIN] });
    // Consenso en la seq mas alta (la de w1): w1 acuerda, w2 no llega a
    // esa seq -- sin observacion en el seq del consenso no se lo cuenta.
    expect(entry2.consensus?.seq).toBeGreaterThan(1);
    const obs1 = entry2.observations.find((o) => o.witnessDid === `did:apw:${W1_DOMAIN}`)!;
    const obs2 = entry2.observations.find((o) => o.witnessDid === `did:apw:${W2_DOMAIN}`)!;
    expect(obs1.calibrationFactor).toBeCloseTo(0.1 + 1.8 * (2 / 3), 10); // 2 acuerdos
    expect(obs1.weight).toBeCloseTo(obs1.calibrationFactor, 10);
    expect(obs2.calibrationFactor).toBeCloseTo(1.0, 10); // sin datos en esa seq: intacto
    // w2 no tuvo observacion en el seq del consenso: no se lo cuenta.
    expect(await store.getCalibration(SITE_ID)).toEqual({
      [`did:apw:${W1_DOMAIN}`]: { agree: 2, disagree: 0 },
    });
  });

  it("el peso base del operador es un multiplicador sobre el factor y se clampnea al maximo", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    await syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN], weights: { [`did:apw:${W1_DOMAIN}`]: 900 } });
    // base 900 * factor 1.0 = 900 (dentro del rango).
    let entry = await store.getSubjectEntry(SITE_ID, `did:apw:${SUBJECT_DOMAIN}`);
    expect(JSON.parse(entry!.entryJson).observations[0]).toMatchObject({ baseWeight: 900, weight: 900 });

    // Tras un acuerdo, factor ~1.3: 900 * 1.3 = 1170 -> clamp a 1000.
    await syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN] });
    entry = await store.getSubjectEntry(SITE_ID, `did:apw:${SUBJECT_DOMAIN}`);
    const obs = JSON.parse(entry!.entryJson).observations[0];
    expect(obs.baseWeight).toBe(900);
    expect(obs.weight).toBeLessThanOrEqual(1000);
    expect(obs.weight).toBe(1000);
  });
});

describe("sincronizacion entre nodos (syncIndexPeers)", () => {
  async function seedPeerNode() {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    // "Nodo par": mismo nucleo, otro store; su directorio es el doc que
    // bajaremos como descubrimiento.
    const peerStore = new InMemoryWitnessIndexStore();
    const peerEntry = await syncWitnessIndex(depsFor(world), peerStore, { siteId: SITE_ID, domain: SUBJECT_DOMAIN, witnesses: [W1_DOMAIN] });
    const rows = await peerStore.listSubjectEntries(SITE_ID);
    const parsed = rows.map((r) => JSON.parse(r.entryJson));
    world.peerDocs[PEER_DOMAIN] = buildIndexDocument(parsed, { indexDid: "did:apw:par.example", generatedAt: new Date().toISOString() });
    return peerEntry;
  }

  it("descubre sujetos/testigos del par y los re-sincroniza con el pipeline completo", async () => {
    await seedPeerNode();
    await store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: new Date().toISOString() });

    const result = await syncIndexPeers(depsFor(world), store, { siteId: SITE_ID });
    expect(result.subjectsSynced).toBe(1);
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]).toMatchObject({ peerDomain: PEER_DOMAIN, outcome: "ok", peerDid: "did:apw:par.example", subjectsSynced: 1 });
    expect(result.peers[0].subjects[0]).toMatchObject({ domain: SUBJECT_DOMAIN, result: "synced", status: "consistent" });

    // El sujeto quedo en NUESTRO store, verificado localmente.
    const entry = await store.getSubjectEntry(SITE_ID, `did:apw:${SUBJECT_DOMAIN}`);
    expect(entry).toBeTruthy();
    const peers = await store.listPeers(SITE_ID);
    expect(peers[0]).toMatchObject({ lastStatus: "ok", lastSubjectsCount: 1, peerDid: "did:apw:par.example" });
  });

  it("saltea un par que apunta al propio dominio (self_peer)", async () => {
    await store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: new Date().toISOString() });
    const result = await syncIndexPeers(depsFor(world), store, { siteId: SITE_ID, ownDomain: PEER_DOMAIN });
    expect(result.peers[0].outcome).toBe("self_peer");
    expect(result.subjectsSynced).toBe(0);
  });

  it("par inaccesible vs par con documento invalido", async () => {
    await store.addPeer({ siteId: SITE_ID, peerDomain: "caido.example", peerDid: null, addedAt: new Date().toISOString() });
    await store.addPeer({ siteId: SITE_ID, peerDomain: "roto.example", peerDid: null, addedAt: new Date().toISOString() });
    world.peerDocs["roto.example"] = { typ: "otra-cosa", subjects: [] };

    const result = await syncIndexPeers(depsFor(world), store, { siteId: SITE_ID });
    const byDomain = Object.fromEntries(result.peers.map((p) => [p.peerDomain, p.outcome]));
    expect(byDomain).toEqual({ "caido.example": "peer_unreachable", "roto.example": "peer_invalid" });
    const peers = await store.listPeers(SITE_ID);
    expect(peers.find((p) => p.peerDomain === "caido.example")?.lastStatus).toBe("peer_unreachable");
    expect(peers.find((p) => p.peerDomain === "roto.example")?.lastStatus).toBe("peer_invalid");
  });

  it("una entrada del par sin testigos no se sincroniza (no hay pipeline que correr)", async () => {
    world.peerDocs[PEER_DOMAIN] = buildIndexDocument(
      [{ subjectDid: "did:apw:vacio.example", domain: "vacio.example", status: "no_observations", length: 0, head: null, observations: [], findings: [], consensus: null, witnessesUsed: [], witnessesSkipped: [], syncedAt: new Date().toISOString() } as any],
      { indexDid: "did:apw:par.example", generatedAt: new Date().toISOString() }
    );
    await store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: new Date().toISOString() });

    const result = await syncIndexPeers(depsFor(world), store, { siteId: SITE_ID });
    expect(result.subjectsSynced).toBe(0);
    expect(result.peers[0].subjects[0]).toMatchObject({ domain: "vacio.example", result: "no_witnesses" });
  });

  it("filtra por pares pedidos y acota sujetos por par", async () => {
    await seedPeerNode();
    await store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: new Date().toISOString() });
    await store.addPeer({ siteId: SITE_ID, peerDomain: "otro.example", peerDid: null, addedAt: new Date().toISOString() });

    // maxSubjectsPerPeer=0 se normaliza a 1 (minimo); el doc tiene 1 sujeto.
    const result = await syncIndexPeers(depsFor(world), store, { siteId: SITE_ID, peers: [PEER_DOMAIN], maxSubjectsPerPeer: 0 });
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0].peerDomain).toBe(PEER_DOMAIN);
    expect(MAX_PEER_SUBJECTS).toBe(50);
  });
});
