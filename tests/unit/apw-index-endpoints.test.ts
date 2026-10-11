// Portaless Index (APW 5.7, seccion 7): endpoints.
// POST /admin/api/index/sync (admin, validacion de body, wiring real del
// nucleo), GET /admin/api/index/subjects (admin, directorio cacheado) y
// GET /.well-known/apw-index.json (publico, documento plano re-verificable).
// El nucleo NO se mockea en el happy path: el material es real (claves,
// statements firmados, cadenas); solo la red y la resolucion son fixtures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryWitnessIndexStore } from "../../packages/apw-resolver/src/did-apw/witness-index-store";
import { INDEX_DOC_TYP } from "../../packages/apw-resolver/src/did-apw/witness-index";
import {
  appendIndexChain,
  indexHistoryOf,
  makeIndexSite,
  recordIndexObservation,
  witnessDocOf,
  SITE_ID,
} from "../helpers/apw-witness-index";
import { onRequestPost as syncPost } from "../../functions/admin/api/index/sync.js";
import { onRequestGet as subjectsGet } from "../../functions/admin/api/index/subjects.js";
import { onRequestGet as indexGet } from "../../functions/.well-known/apw-index.json.js";

const state = vi.hoisted(() => ({
  store: null as any,
  identityRow: null as any,
  histories: {} as Record<string, any>,
  docs: {} as Record<string, any>,
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
    const m = url.match(/^https:\/\/([^/]+)\/\.well-known\/apw-witnesses\.json/);
    const doc = m ? state.docs[m[1]] : undefined;
    if (!doc) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => JSON.stringify(doc) };
  })
);

const ADMIN = { role: "admin" };

function postCtx(body: unknown, user?: { role: string }) {
  return {
    env: {},
    request: new Request("https://indice.example/admin/api/index/sync", {
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

beforeEach(() => {
  state.store = new InMemoryWitnessIndexStore();
  state.identityRow = { did: "did:apw:indice.example" };
  state.histories = {};
  state.docs = {};
});

async function seedHappyPath() {
  const subject = await makeIndexSite("sujeto.example");
  const w1 = await makeIndexSite("t1.example");
  await appendIndexChain(subject, 2);
  await recordIndexObservation(w1, subject);
  state.histories["sujeto.example"] = await indexHistoryOf(subject);
  state.histories["t1.example"] = await indexHistoryOf(w1);
  state.docs["t1.example"] = await witnessDocOf(w1);
}

describe("POST /admin/api/index/sync", () => {
  it("exige sesion y rol admin", async () => {
    expect((await syncPost(postCtx({ domain: "sujeto.example", witnesses: ["t1.example"] }))).status).toBe(401);
    expect((await syncPost(postCtx({ domain: "sujeto.example", witnesses: ["t1.example"] }, { role: "viewer" }))).status).toBe(403);
  });

  it("valida el body: json, dominio, witnesses y weights", async () => {
    const bad = await syncPost(postCtx("{no-json", ADMIN));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_json_body");

    for (const body of [
      {},
      { domain: "https://sujeto.example/path", witnesses: ["t1.example"] },
      { domain: "sujeto.example", witnesses: [] },
      { domain: "sujeto.example", witnesses: ["t1.example", "no es host"] },
      { domain: "sujeto.example", witnesses: ["t1.example"], weights: "x" },
      { domain: "sujeto.example", witnesses: ["t1.example"], weights: { "did:apw:t1.example": -1 } },
      { domain: "sujeto.example", witnesses: ["t1.example"], weights: { "no-did": 1 } },
    ]) {
      const res = await syncPost(postCtx(body, ADMIN));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("happy path: sincroniza con el nucleo real y cachea la entrada de directorio", async () => {
    await seedHappyPath();
    const res = await syncPost(
      postCtx({ domain: "sujeto.example", witnesses: ["t1.example"], weights: { "did:apw:t1.example": 0.5 } }, ADMIN)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toMatchObject({
      subjectDid: "did:apw:sujeto.example",
      domain: "sujeto.example",
      status: "consistent",
      length: 2,
      witnessesUsed: ["did:apw:t1.example"],
      witnessesSkipped: [],
    });
    expect(body.synced.observations).toHaveLength(1);
    expect(body.synced.observations[0]).toMatchObject({ witnessDid: "did:apw:t1.example", seq: 2, weight: 0.5 });
    expect(body.synced.consensus).toMatchObject({ seq: 2, weight: 0.5 });

    const cached = await state.store.getSubjectEntry(SITE_ID, "did:apw:sujeto.example");
    expect(cached).not.toBeNull();
  });

  it("un testigo caido se saltea (cadena no verificable) sin tumbar el sync", async () => {
    await seedHappyPath();
    const res = await syncPost(postCtx({ domain: "sujeto.example", witnesses: ["t1.example", "caido.example"] }, ADMIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced.witnessesUsed).toEqual(["did:apw:t1.example"]);
    expect(body.synced.witnessesSkipped).toEqual([{ witnessDomain: "caido.example", reason: "witness_chain_unverified" }]);
  });
});

describe("GET /admin/api/index/subjects", () => {
  it("exige sesion y rol admin", async () => {
    expect((await subjectsGet(getCtx("/admin/api/index/subjects"))).status).toBe(401);
    expect((await subjectsGet(getCtx("/admin/api/index/subjects", { role: "viewer" }))).status).toBe(403);
  });

  it("lista el directorio cacheado con los pesos y filtra por subject", async () => {
    await seedHappyPath();
    await syncPost(postCtx({ domain: "sujeto.example", witnesses: ["t1.example"], weights: { "did:apw:t1.example": 2 } }, ADMIN));

    const list = await (await subjectsGet(getCtx("/admin/api/index/subjects", ADMIN))).json();
    expect(list.subjects).toHaveLength(1);
    expect(list.subjects[0]).toMatchObject({ subjectDid: "did:apw:sujeto.example", status: "consistent" });
    expect(list.weights).toEqual({ "did:apw:t1.example": 2 });

    const one = await subjectsGet(getCtx("/admin/api/index/subjects?subject=did:apw:sujeto.example", ADMIN));
    expect(one.status).toBe(200);
    expect((await one.json()).subject).toMatchObject({ subjectDid: "did:apw:sujeto.example" });

    const missing = await subjectsGet(getCtx("/admin/api/index/subjects?subject=did:apw:nadie.example", ADMIN));
    expect(missing.status).toBe(404);
  });

  it("una entrada de directorio corrupta no tumba el listado", async () => {
    await state.store.saveSubjectEntry({
      siteId: SITE_ID,
      subjectDid: "did:apw:roto.example",
      domain: "roto.example",
      entryJson: "no-json",
      updatedAt: "t",
    });
    const list = await (await subjectsGet(getCtx("/admin/api/index/subjects", ADMIN))).json();
    expect(list.subjects).toEqual([]);
  });
});

describe("GET /.well-known/apw-index.json", () => {
  it("404 sin identidad del sitio", async () => {
    state.identityRow = null;
    expect((await indexGet(getCtx("/.well-known/apw-index.json"))).status).toBe(404);
  });

  it("publica el documento plano con typ, iss y las entradas cacheadas", async () => {
    await seedHappyPath();
    await syncPost(postCtx({ domain: "sujeto.example", witnesses: ["t1.example"] }, ADMIN));

    const res = await indexGet(getCtx("/.well-known/apw-index.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const doc = await res.json();
    expect(doc).toMatchObject({ typ: INDEX_DOC_TYP, iss: "did:apw:indice.example" });
    expect(doc.subjects).toHaveLength(1);
    expect(doc.subjects[0]).toMatchObject({ subjectDid: "did:apw:sujeto.example", status: "consistent" });
    expect(typeof doc.generatedAt).toBe("string");
  });

  it("sin entradas publica un directorio vacio, no un error", async () => {
    const res = await indexGet(getCtx("/.well-known/apw-index.json"));
    expect(res.status).toBe(200);
    expect((await res.json()).subjects).toEqual([]);
  });
});
