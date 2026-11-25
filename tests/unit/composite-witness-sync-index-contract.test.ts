// E-08 Flujo compuesto 2 (determinista, sin red externa):
// witness (POST /admin/api/witness/record) -> publicacion (GET /.well-known/apw-witnesses.json)
// -> sync (POST /admin/api/index/sync) -> directorio publico (GET /.well-known/apw-index.json).
// Usa las primitivas criptograficas reales de @verared/apw/did-apw y los handlers reales
// de functions/ con un transporte en memoria (cero red externa).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryWitnessIndexStore, INDEX_DOC_TYP } from "@verared/apw/did-apw";
import {
  appendIndexChain,
  indexHistoryOf,
  makeIndexSite,
  SITE_ID,
} from "../helpers/apw-witness-index";

const state = vi.hoisted(() => ({
  activeIdentityStore: null as any,
  activeLogStore: null as any,
  indexStore: null as any,
  histories: {} as Record<string, any>,
  witnessDocs: {} as Record<string, any>,
}));

vi.mock("@portaless/trust-storage-adapters", () => ({
  createSiteIdentityStore: async () => state.activeIdentityStore,
  createAttestationLogStore: async () => state.activeLogStore,
  createWitnessIndexStore: async () => state.indexStore,
}));

vi.mock("@portaless/dashboard/activity", () => ({
  emitActivity: async () => {},
}));

vi.mock("@verared/apw/did-apw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@verared/apw/did-apw")>();
  return {
    ...actual,
    resolveApwHistory: async (domain: string) =>
      state.histories[domain] ?? { verified: false, reason: "manifest_not_resolved", domain },
  };
});

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: any) => {
    const url = String(input);
    const m = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
    const doc = m ? state.witnessDocs[m[1]] : undefined;
    if (!doc) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => JSON.stringify(doc) };
  })
);

import { onRequestPost as witnessRecordPost } from "../../functions/admin/api/witness/record.js";
import { onRequestGet as witnessesWellKnownGet } from "../../functions/.well-known/apw-witnesses.json.js";
import { onRequestPost as indexSyncPost } from "../../functions/admin/api/index/sync.js";
import { onRequestGet as indexWellKnownGet } from "../../functions/.well-known/apw-index.json.js";

describe("E-08 composite contract: witness -> publish -> sync -> index", () => {
  beforeEach(() => {
    state.indexStore = new InMemoryWitnessIndexStore();
    state.histories = {};
    state.witnessDocs = {};
  });

  it("chains witness recording, /.well-known/apw-witnesses.json, index sync, and /.well-known/apw-index.json", async () => {
    const subject = await makeIndexSite("subject.example");
    await appendIndexChain(subject, "self-subject-1");
    const witness = await makeIndexSite("witness.example");
    const indexNode = await makeIndexSite("index.example");

    // 1. Subject history is observable by witness.example
    state.histories["subject.example"] = await indexHistoryOf(subject);

    // 2. Witness node records a signed witness statement via POST /admin/api/witness/record
    state.activeIdentityStore = witness.identity;
    state.activeLogStore = witness.log;

    const recordRes = await witnessRecordPost({
      request: new Request("https://witness.example/admin/api/witness/record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "subject.example" }),
      }),
      env: {},
      data: { user: { username: "admin", role: "admin" } },
    } as any);
    expect(recordRes.status).toBe(201);
    const recordBody = await recordRes.json();
    expect(recordBody.recorded).toBe(true);
    expect(recordBody.subject).toBe("did:apw:subject.example");

    // 3. Witness publishes its signed statement at GET /.well-known/apw-witnesses.json
    const witnessesRes = await witnessesWellKnownGet({
      request: new Request("https://witness.example/.well-known/apw-witnesses.json"),
      env: {},
      data: {},
    } as any);
    expect(witnessesRes.status).toBe(200);
    const witnessesDoc = await witnessesRes.json();
    expect(witnessesDoc.entries).toHaveLength(1);
    expect(witnessesDoc.entries[0].witness.sub).toBe("did:apw:subject.example");

    // Expose witness.example's updated history + published witnesses doc to the index node
    state.histories["witness.example"] = await indexHistoryOf(witness);
    state.witnessDocs["witness.example"] = witnessesDoc;

    // 4. Index node syncs subject.example against witness.example via POST /admin/api/index/sync
    state.activeIdentityStore = indexNode.identity;
    state.activeLogStore = indexNode.log;

    const syncRes = await indexSyncPost({
      request: new Request("https://index.example/admin/api/index/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "subject.example",
          witnesses: ["witness.example"],
        }),
      }),
      env: {},
      data: { user: { username: "admin", role: "admin" } },
    } as any);
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json();
    expect(syncBody.synced.status).toBe("consistent");
    expect(syncBody.synced.observations).toHaveLength(1);
    expect(syncBody.synced.observations[0].witnessDid).toBe("did:apw:witness.example");

    // 5. Index node publishes the verifiable directory at GET /.well-known/apw-index.json
    const indexRes = await indexWellKnownGet({
      request: new Request("https://index.example/.well-known/apw-index.json"),
      env: {},
      data: {},
    } as any);
    expect(indexRes.status).toBe(200);
    const indexDoc = await indexRes.json();
    expect(indexDoc.typ).toBe(INDEX_DOC_TYP);
    expect(indexDoc.iss).toBe("did:apw:index.example");
    expect(indexDoc.subjects).toHaveLength(1);
    expect(indexDoc.subjects[0].subjectDid).toBe("did:apw:subject.example");
    expect(indexDoc.subjects[0].status).toBe("consistent");
    expect(indexDoc.subjects[0].consensus.seq).toBe(recordBody.subjectSeq);
    expect(indexDoc.subjects[0].consensus.head).toBe(recordBody.subjectHead);
  });
});
