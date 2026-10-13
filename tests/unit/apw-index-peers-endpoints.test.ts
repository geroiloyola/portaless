// Portaless Index Phase 5: endpoints de pares y sincronizacion entre nodos.
// GET/POST /admin/api/index/peers (admin) y POST /admin/api/index/sync-peers
// (admin). El nucleo NO se mockea en el happy path: material real (claves,
// statements, cadenas); solo la red y la resolucion son fixtures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryWitnessIndexStore } from "../../packages/apw-resolver/src/did-apw/witness-index-store";
import { buildIndexDocument } from "../../packages/apw-resolver/src/did-apw/witness-index";
import {
  appendIndexChain,
  indexHistoryOf,
  makeIndexSite,
  recordIndexObservation,
  witnessDocOf,
  SITE_ID,
} from "../helpers/apw-witness-index";
import { onRequestGet as peersGet, onRequestPost as peersPost } from "../../functions/admin/api/index/peers.js";
import { onRequestPost as syncPeersPost } from "../../functions/admin/api/index/sync-peers.js";

const state = vi.hoisted(() => ({
  store: null as any,
  identityRow: null as any,
  histories: {} as Record<string, any>,
  docs: {} as Record<string, any>,
  peerDocs: {} as Record<string, any>,
}));

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createWitnessIndexStore: async () => state.store,
  createSiteIdentityStore: async () => ({ get: async () => state.identityRow }),
}));

vi.mock("../../packages/apw-resolver/src/did-apw/history-resolver.ts", () => ({
  resolveApwHistory: async (domain: string) =>
    state.histories[domain] ?? { verified: false, reason: "manifest_not_resolved", domain },
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: any) => {
    const url = String(input);
    const wm = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
    if (wm) {
      const doc = state.docs[wm[1]];
      return doc ? { ok: true, status: 200, text: async () => JSON.stringify(doc) } : { ok: false, status: 404, text: async () => "" };
    }
    const pm = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-index\.json/);
    if (pm) {
      const doc = state.peerDocs[pm[1]];
      return doc ? { ok: true, status: 200, text: async () => JSON.stringify(doc) } : { ok: false, status: 404, text: async () => "" };
    }
    return { ok: false, status: 404, text: async () => "" };
  })
);

const ADMIN = { role: "admin" };
const PEER_DOMAIN = "par.example";

function peersCtx(body: unknown, user?: { role: string }) {
  return {
    env: {},
    request: new Request("https://indice.example/admin/api/index/peers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    data: user ? { user } : {},
  };
}

function getCtx(path: string, user?: { role: string }) {
  return { env: {}, request: new Request(`https://indice.example${path}`), data: user ? { user } : {} };
}

function syncPeersCtx(body?: unknown) {
  return {
    env: {},
    request: new Request("https://indice.example/admin/api/index/sync-peers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    data: { user: ADMIN },
  };
}

beforeEach(() => {
  state.store = new InMemoryWitnessIndexStore();
  state.identityRow = { did: "did:apw:indice.example" };
  state.histories = {};
  state.docs = {};
  state.peerDocs = {};
});

async function seedPeerDoc() {
  const subject = await makeIndexSite("sujeto.example");
  const w1 = await makeIndexSite("t1.example");
  await appendIndexChain(subject, 2);
  await recordIndexObservation(w1, subject);
  state.histories["sujeto.example"] = await indexHistoryOf(subject);
  state.histories["t1.example"] = await indexHistoryOf(w1);
  state.docs["t1.example"] = await witnessDocOf(w1);

  const peerStore = new InMemoryWitnessIndexStore();
  const { syncWitnessIndex } = await import("../../packages/apw-resolver/src/did-apw/witness-index");
  const deps = {
    fetchText: async (url: string) => {
      const m = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
      const doc = m ? state.docs[m[1]] : undefined;
      return doc ? JSON.stringify(doc) : null;
    },
    resolveHistory: async (domain: string) => state.histories[domain] ?? { verified: false, reason: "x", domain },
  };
  await syncWitnessIndex(deps, peerStore, { siteId: SITE_ID, domain: "sujeto.example", witnesses: ["t1.example"] });
  const rows = await peerStore.listSubjectEntries(SITE_ID);
  state.peerDocs[PEER_DOMAIN] = buildIndexDocument(
    rows.map((r) => JSON.parse(r.entryJson)),
    { indexDid: "did:apw:par.example", generatedAt: new Date().toISOString() }
  );
}

describe("GET /admin/api/index/peers", () => {
  it("exige sesion y rol admin", async () => {
    expect((await peersGet(getCtx("/admin/api/index/peers"))).status).toBe(401);
    expect((await peersGet(getCtx("/admin/api/index/peers", { role: "viewer" }))).status).toBe(403);
  });

  it("lista los pares configurados", async () => {
    await state.store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: "t1" });
    const res = await peersGet(getCtx("/admin/api/index/peers", ADMIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.peers).toHaveLength(1);
    expect(body.peers[0]).toMatchObject({ peerDomain: PEER_DOMAIN, lastStatus: "never_synced" });
  });
});

describe("POST /admin/api/index/peers", () => {
  it("exige sesion y rol admin, valida domain y action", async () => {
    expect((await peersPost(peersCtx({ domain: PEER_DOMAIN }))).status).toBe(401);
    expect((await peersPost(peersCtx({ domain: PEER_DOMAIN }, { role: "viewer" }))).status).toBe(403);
    expect((await peersPost(peersCtx({ domain: "no es hostname" }, ADMIN)).then((r) => r.status))).toBe(400);
    expect((await peersPost(peersCtx({ domain: PEER_DOMAIN, action: "explode" }, ADMIN)).then((r) => r.status))).toBe(400);
  });

  it("rechaza como par el propio dominio del nodo (self_peer)", async () => {
    const res = await peersPost(peersCtx({ domain: "indice.example" }, ADMIN));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("self_peer");
  });

  it("agrega (201, idempotente) y quita (200/404) un par", async () => {
    const added = await peersPost(peersCtx({ domain: PEER_DOMAIN }, ADMIN));
    expect(added.status).toBe(201);
    expect((await added.json()).peer).toMatchObject({ peerDomain: PEER_DOMAIN });

    // Re-alta no duplica.
    expect((await peersPost(peersCtx({ domain: PEER_DOMAIN }, ADMIN))).status).toBe(201);
    expect((await (await peersGet(getCtx("/admin/api/index/peers", ADMIN))).json()).peers).toHaveLength(1);

    const removed = await peersPost(peersCtx({ domain: PEER_DOMAIN, action: "remove" }, ADMIN));
    expect(removed.status).toBe(200);
    expect((await removed.json()).removed).toBe(true);
    expect((await peersPost(peersCtx({ domain: PEER_DOMAIN, action: "remove" }, ADMIN))).status).toBe(404);
  });
});

describe("POST /admin/api/index/sync-peers", () => {
  it("exige sesion y rol admin y valida peers del body", async () => {
    expect((await syncPeersPost({ env: {}, request: syncPeersCtx().request, data: {} })).status).toBe(401);
    expect((await syncPeersPost({ env: {}, request: syncPeersCtx().request, data: { user: { role: "viewer" } } })).status).toBe(403);
    const bad = await syncPeersPost(syncPeersCtx({ peers: [] }));
    expect(bad.status).toBe(400);
  });

  it("baja el documento del par, re-sincroniza con el pipeline completo y reporta", async () => {
    await seedPeerDoc();
    await state.store.addPeer({ siteId: SITE_ID, peerDomain: PEER_DOMAIN, peerDid: null, addedAt: "t1" });

    const res = await syncPeersPost(syncPeersCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjectsSynced).toBe(1);
    expect(body.peers[0]).toMatchObject({ peerDomain: PEER_DOMAIN, outcome: "ok", peerDid: "did:apw:par.example", subjectsSynced: 1 });
    expect(body.peers[0].subjects[0]).toMatchObject({ domain: "sujeto.example", result: "synced", status: "consistent" });

    // Quedo en el store local, listo para publicar en apw-index.json.
    const entry = await state.store.getSubjectEntry(SITE_ID, "did:apw:sujeto.example");
    expect(entry).toBeTruthy();
  });

  it("un par que no responde se reporta peer_unreachable sin tumbar el sync", async () => {
    await state.store.addPeer({ siteId: SITE_ID, peerDomain: "caido.example", peerDid: null, addedAt: "t1" });
    const res = await syncPeersPost(syncPeersCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjectsSynced).toBe(0);
    expect(body.peers[0]).toMatchObject({ peerDomain: "caido.example", outcome: "peer_unreachable" });
  });
});
