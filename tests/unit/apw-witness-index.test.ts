// Portaless Index (APW v1.3, 5.7 y seccion 7): agregador de testigos.
// Todo el material es REAL (claves Ed25519, statements firmados, cadenas
// encadenadas con appendAttestation): los checks del pipeline -- anclaje en
// la cadena del testigo, att === sha256(jws), firma, jti determinista --
// corren de verdad; solo la red y la resolucion de cadenas son fixtures.
import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import { signSiteJws } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { signWitnessStatement, WITNESS_TYP } from "../../packages/apw-resolver/src/did-apw/witness";
import {
  buildIndexDocument,
  collectWitnessStatements,
  parseSubjectEntry,
  syncWitnessIndex,
  INDEX_DOC_TYP,
} from "../../packages/apw-resolver/src/did-apw/witness-index";
import { InMemoryWitnessIndexStore } from "../../packages/apw-resolver/src/did-apw/witness-index-store";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";
import type { ApwHistoryResult } from "../../packages/apw-resolver/src/did-apw/history-resolver";

const ENV = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };
const SITE_ID = "default";
const SUBJECT_DOMAIN = "sujeto.example";
const SUBJECT_DID = `did:apw:${SUBJECT_DOMAIN}`;
const W1_DOMAIN = "t1.example";
const W1_DID = `did:apw:${W1_DOMAIN}`;
const W2_DOMAIN = "t2.example";
const W2_DID = `did:apw:${W2_DOMAIN}`;

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

async function appendChain(site: Site, count: number, now?: () => Date): Promise<void> {
  for (let i = 1; i <= count; i++) await appendAttestation(now ? { ...site.deps, now } : site.deps, fakeAttestation(i));
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

/** Documento /.well-known/apw-witnesses.json del testigo, desde su cadena real. */
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

/** El testigo anota una observacion de la cadena ACTUAL del sujeto en su propio historial. */
async function recordObservation(witness: Site, subject: Site, opts: { ts?: string } = {}): Promise<void> {
  const history = await historyOf(subject);
  const key = await witness.identity.getActiveSigningKey(SITE_ID);
  const { jws } = await signWitnessStatement(
    { iss: witness.did, sub: subject.did, seq: history.length ?? 0, head: history.head ?? null, ts: opts.ts ?? new Date().toISOString() },
    { keyId: key!.keyId, privateKeyJwk: key!.privateKeyJwk }
  );
  await appendAttestation(witness.deps, jws);
}

interface World {
  histories: Record<string, ApwHistoryResult>;
  docs: Record<string, any>;
}

function depsFor(world: World) {
  return {
    fetchText: async (url: string) => {
      const m = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
      const doc = m ? world.docs[m[1]] : undefined;
      return doc ? JSON.stringify(doc) : null;
    },
    resolveHistory: async (domain: string) =>
      world.histories[domain] ?? { verified: false, reason: "manifest_not_resolved", domain },
  };
}

let store: InMemoryWitnessIndexStore;
let world: World;

beforeEach(() => {
  store = new InMemoryWitnessIndexStore();
  world = { histories: {}, docs: {} };
});

async function sync(input: { domain?: string; witnesses: string[]; weights?: Record<string, number> }) {
  return syncWitnessIndex(depsFor(world), store, { siteId: SITE_ID, domain: input.domain ?? SUBJECT_DOMAIN, ...input });
}

describe("Portaless Index: syncWitnessIndex", () => {
  it("camino feliz: un testigo verifica de punta a punta y el sujeto queda consistente", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject, { ts: "2020-01-01T00:00:00.000Z" });
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const entry = await sync({ witnesses: [W1_DOMAIN] });

    expect(entry.status).toBe("consistent");
    expect(entry.length).toBe(2);
    expect(entry.findings).toEqual([]);
    expect(entry.witnessesUsed).toEqual([W1_DID]);
    expect(entry.witnessesSkipped).toEqual([]);
    expect(entry.observations).toHaveLength(1);
    expect(entry.observations[0]).toMatchObject({ witnessDid: W1_DID, seq: 2, head: entry.head, weight: 1 });
    // La fecha creible es la del historial DEL TESTIGO, no el ts declarado (2020).
    expect(entry.observations[0].anchoredTs).not.toBe("2020-01-01T00:00:00.000Z");
    const w1Chain = await historyOf(w1);
    expect(entry.observations[0].anchoredTs).toBe(w1Chain.attestations![0].ts);
    expect(entry.consensus).toEqual({ seq: 2, head: entry.head, weight: 1 });

    const cached = await store.getSubjectEntry(SITE_ID, SUBJECT_DID);
    expect(parseSubjectEntry(cached?.entryJson)).toMatchObject({ status: "consistent", subjectDid: SUBJECT_DID });
  });

  it("dos testigos de acuerdo: el consenso suma sus pesos", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    const w2 = await makeSite(W2_DOMAIN);
    await appendChain(subject, 1);
    await recordObservation(w1, subject);
    await recordObservation(w2, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.histories[W2_DOMAIN] = await historyOf(w2);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);
    world.docs[W2_DOMAIN] = await witnessDocOf(w2);

    const entry = await sync({ witnesses: [W1_DOMAIN, W2_DOMAIN] });
    expect(entry.status).toBe("consistent");
    expect(entry.observations).toHaveLength(2);
    expect(entry.consensus).toEqual({ seq: 1, head: entry.head, weight: 2 });
  });

  it("head_mismatch: el sujeto reescribio su cadena despues de la observacion anclada", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);

    const rewritten = await makeSite(SUBJECT_DOMAIN);
    await appendChain(rewritten, 2);

    world.histories[SUBJECT_DOMAIN] = await historyOf(rewritten);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const entry = await sync({ witnesses: [W1_DOMAIN] });
    expect(entry.status).toBe("head_mismatch");
    expect(entry.findings.map((f) => f.type)).toContain("head_mismatch");
  });

  it("equivocation ponderada: testigos anclaron heads distintos y el consenso elige por peso", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    const w2 = await makeSite(W2_DOMAIN);

    // w1 observa la cadena ORIGINAL (head A).
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    // El sujeto reescribe su cadena (head B) y w2 observa la NUEVA.
    const rewritten = await makeSite(SUBJECT_DOMAIN);
    await appendChain(rewritten, 2);
    await recordObservation(w2, rewritten);

    world.histories[SUBJECT_DOMAIN] = await historyOf(rewritten);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.histories[W2_DOMAIN] = await historyOf(w2);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);
    world.docs[W2_DOMAIN] = await witnessDocOf(w2);

    const entry = await sync({
      witnesses: [W1_DOMAIN, W2_DOMAIN],
      weights: { [W1_DID]: 0.75, [W2_DID]: 0.25 },
    });

    expect(entry.status).toBe("equivocation");
    expect(entry.findings.some((f) => f.type === "equivocation")).toBe(true);
    expect(entry.findings.some((f) => f.type === "head_mismatch")).toBe(true);
    // w1 (0.75) anclo head A; w2 (0.25) anclo head B = cadena actual. El consenso ponderado es A.
    const headA = (await historyOf(subject)).head;
    expect(entry.consensus).toEqual({ seq: 2, head: headA, weight: 0.75 });
    expect(entry.head).toBe((await historyOf(rewritten)).head);
    expect(entry.observations.map((o) => o.weight).sort()).toEqual([0.25, 0.75]);
    expect(await store.getWeights(SITE_ID)).toEqual({ [W1_DID]: 0.75, [W2_DID]: 0.25 });
  });

  it("cadena del sujeto no verificable: las observaciones se guardan igual y el status lo dice", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    await recordObservation(w1, subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const entry = await sync({ witnesses: [W1_DOMAIN] });
    expect(entry.status).toBe("subject_chain_unverified");
    expect(entry.length).toBeNull();
    expect(entry.observations).toHaveLength(1);
    expect(await store.listObservations(SITE_ID, SUBJECT_DID)).toHaveLength(1);
  });

  it("re-sincronizar es idempotente: no duplica observaciones ni cambia el estado", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 2);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const first = await sync({ witnesses: [W1_DOMAIN] });
    const second = await sync({ witnesses: [W1_DOMAIN] });
    expect(second.observations).toHaveLength(1);
    expect(second.status).toBe(first.status);
    expect(await store.listObservations(SITE_ID, SUBJECT_DID)).toHaveLength(1);
  });

  it("sin observaciones el directorio queda en no_observations", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    await appendChain(subject, 1);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    const entry = await sync({ witnesses: [] });
    expect(entry.status).toBe("no_observations");
    expect(entry.consensus).toBeNull();
  });

  it("rechaza weights con DID invalido o peso fuera de rango", async () => {
    await expect(sync({ witnesses: [W1_DOMAIN], weights: { "no-did": 1 } })).rejects.toThrow("invalid_witness_did");
    await expect(sync({ witnesses: [W1_DOMAIN], weights: { [W1_DID]: -1 } })).rejects.toThrow("invalid_witness_weight");
  });
});

describe("Portaless Index: fail-closed por testigo", () => {
  it("cadena del testigo no verificada: se saltea entero (witness_chain_unverified)", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    await appendChain(subject, 1);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.docs[W1_DOMAIN] = { did: W1_DID, entries: [], next: null };

    const entry = await sync({ witnesses: [W1_DOMAIN] });
    expect(entry.witnessesUsed).toEqual([]);
    expect(entry.witnessesSkipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "witness_chain_unverified" }]);
    expect(entry.observations).toHaveLength(0);
  });

  it("endpoint del testigo inaccesible o con did ajeno: se saltea entero", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);

    const unreachable = await sync({ witnesses: [W1_DOMAIN] });
    expect(unreachable.witnessesSkipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "witness_endpoint_unreachable" }]);

    world.docs[W1_DOMAIN] = { did: "did:apw:otro.example", entries: [], next: null };
    const mismatch = await sync({ witnesses: [W1_DOMAIN] });
    expect(mismatch.witnessesSkipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "witness_did_mismatch" }]);
  });

  it("un statement no anclado en la cadena del testigo no cuenta", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    const doc = await witnessDocOf(w1);
    doc.entries.push({ ...doc.entries[0], seq: 999 });
    world.docs[W1_DOMAIN] = doc;

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(1);
    expect(result.skipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "statement_not_anchored" }]);
  });

  it("un statement cuyo jws no es el anclado en la cadena del testigo no cuenta", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);

    // El documento publica un JWS distinto al anclado (el `att` del envoltorio no manda:
    // lo que manda es att de la cadena vs sha256(jws) publicado). Ts fijo y distinto:
    // con el mismo ms que la observacion original el jws saldria identico.
    const w1Key = await w1.identity.getActiveSigningKey(SITE_ID);
    const otherStatement = await signWitnessStatement(
      { iss: W1_DID, sub: SUBJECT_DID, seq: 1, head: (await historyOf(subject)).head, ts: "2020-06-01T00:00:00.000Z" },
      { keyId: w1Key!.keyId, privateKeyJwk: w1Key!.privateKeyJwk }
    );
    const doc = await witnessDocOf(w1);
    doc.entries[0].jws = otherStatement.jws;
    world.docs[W1_DOMAIN] = doc;

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "statement_att_mismatch" }]);
  });

  it("un statement firmado con clave ajena no cuenta (bad_signature)", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);

    // Firmado por OTRA clave pero con el kid de w1; appendAttestation no verifica firmas ajenas.
    const intruder = await makeSite("intruso.example");
    const intruderKey = await intruder.identity.getActiveSigningKey(SITE_ID);
    const w1Key = await w1.identity.getActiveSigningKey(SITE_ID);
    const forged = await signWitnessStatement(
      { iss: W1_DID, sub: SUBJECT_DID, seq: 1, head: (await historyOf(subject)).head, ts: new Date().toISOString() },
      { keyId: w1Key!.keyId, privateKeyJwk: intruderKey!.privateKeyJwk }
    );
    await appendAttestation(w1.deps, forged.jws);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "statement_invalid:bad_signature" }]);
  });

  it("un jti que no recalcula no cuenta (jti_mismatch)", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);

    const w1Key = await w1.identity.getActiveSigningKey(SITE_ID);
    const forged = await signSiteJws(
      {
        typ: WITNESS_TYP,
        iss: W1_DID,
        sub: SUBJECT_DID,
        seq: 1,
        head: (await historyOf(subject)).head,
        ts: new Date().toISOString(),
        jti: "wt-forged",
      },
      { keyId: w1Key!.keyId, privateKeyJwk: w1Key!.privateKeyJwk },
      WITNESS_TYP
    );
    await appendAttestation(w1.deps, forged);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toEqual([{ witnessDomain: W1_DOMAIN, reason: "statement_invalid:jti_mismatch" }]);
  });

  it("un sujeto no puede testigearse a si mismo (self_witness)", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    await appendChain(subject, 1);
    const subjectKey = await subject.identity.getActiveSigningKey(SITE_ID);
    const selfStatement = await signWitnessStatement(
      { iss: SUBJECT_DID, sub: SUBJECT_DID, seq: 1, head: (await historyOf(subject)).head, ts: new Date().toISOString() },
      { keyId: subjectKey!.keyId, privateKeyJwk: subjectKey!.privateKeyJwk }
    );
    await appendAttestation(subject.deps, selfStatement.jws);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.docs[SUBJECT_DOMAIN] = await witnessDocOf(subject);

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: SUBJECT_DOMAIN });
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toEqual([{ witnessDomain: SUBJECT_DOMAIN, reason: "self_witness" }]);
  });

  it("statements de OTRO sujeto se ignoran barato, sin intentar verificarlos", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    const other = await makeSite("otro.example");
    await appendChain(subject, 1);
    await appendChain(other, 1);
    await recordObservation(w1, other);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const result = await collectWitnessStatements(depsFor(world), { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toEqual([]);
    expect(result.witnessOk).toBe(true);
  });

  it("un statement en la pagina 2 tambien se recoge (paginacion)", async () => {
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);
    await appendChain(subject, 1);
    await recordObservation(w1, subject);
    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    const doc = await witnessDocOf(w1);
    const page1 = { did: W1_DID, entries: [], next: 2 };

    const calls: string[] = [];
    const deps = {
      fetchText: async (url: string) => {
        calls.push(url);
        if (url.includes("from=1")) return JSON.stringify(page1);
        if (url.includes("from=2")) return JSON.stringify({ did: W1_DID, entries: doc.entries, next: null });
        return null;
      },
      resolveHistory: depsFor(world).resolveHistory,
    };
    const result = await collectWitnessStatements(deps, { subjectDid: SUBJECT_DID, witnessDomain: W1_DOMAIN });
    expect(result.observations).toHaveLength(1);
    expect(calls.some((u) => u.includes("from=2"))).toBe(true);
  });

  it("backdated_entry: una entrada posterior al head observado declara un ts anterior al ancla", async () => {
    const oldNow = () => new Date(Date.now() - 3600_000);
    const subject = await makeSite(SUBJECT_DOMAIN);
    const w1 = await makeSite(W1_DOMAIN);

    // La cadena del sujeto "empieza" hace una hora; el testigo la observa AHORA.
    await appendChain(subject, 1, oldNow);
    await recordObservation(w1, subject);
    // La entrada 2 hereda (por el clamp del log) el ts viejo: es backdating respecto del ancla.
    await appendAttestation({ ...subject.deps, now: oldNow }, fakeAttestation(99));

    world.histories[SUBJECT_DOMAIN] = await historyOf(subject);
    world.histories[W1_DOMAIN] = await historyOf(w1);
    world.docs[W1_DOMAIN] = await witnessDocOf(w1);

    const entry = await sync({ witnesses: [W1_DOMAIN] });
    expect(entry.status).toBe("backdated_entry");
    expect(entry.findings.some((f) => f.type === "backdated_entry")).toBe(true);
  });
});

describe("Portaless Index: documento publico", () => {
  it("buildIndexDocument arma el documento plano y parseSubjectEntry ignora lo corrupto", async () => {
    const doc = buildIndexDocument([], { indexDid: "did:apw:indice.example", generatedAt: "t" });
    expect(doc).toMatchObject({ typ: INDEX_DOC_TYP, iss: "did:apw:indice.example", generatedAt: "t", subjects: [] });

    expect(parseSubjectEntry('{"subjectDid":"did:apw:x","domain":"x","status":"consistent","observations":[],"findings":[]}')).not.toBeNull();
    expect(parseSubjectEntry('{"subjectDid":"did:apw:x"}')).toBeNull();
    expect(parseSubjectEntry("no-json")).toBeNull();
    expect(parseSubjectEntry(null)).toBeNull();
  });
});
