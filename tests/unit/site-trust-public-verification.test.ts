// GET /trust/:siteId: metadatos aditivos de verificabilidad de las cuatro
// fuentes. community marca por fila si la atestación firmada fue verificada
// al ingreso o si es opinión legacy sin firma; añade un booleano `signed`
// para que el consumidor distinga ambas fuentes sin mostrar un promedio mezclado.
// Desde B3 (ERRATA E-5), self es verificable si la fila trae attestationJws.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ snapshot: null as any }));
vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => ({ getSnapshot: async () => state.snapshot }),
}));

beforeEach(() => {
  state.snapshot = {
    siteId: "ejemplo.com",
    self: [{ category: "privacy_policy" }],
    agent: [{ category: "https_and_headers" }],
    community: [{ category: "content_accuracy", score: 4 }],
    escrowReports: [{ transactionOutcome: "completed_as_promised" }],
  };
});

describe("GET /trust/:siteId: verification metadata", () => {
  async function get(siteId = "ejemplo.com") {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    return onRequestGet({ env: {}, params: siteId ? { siteId } : {} });
  }

  it("conserva las cuatro fuentes y agrega metadatos aditivos", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.siteId).toBe("ejemplo.com");
    expect(body.self).toEqual(state.snapshot.self);
    expect(body.agent).toEqual(state.snapshot.agent);
    expect(body.community).toEqual([{ ...state.snapshot.community[0], signed: false }]);
    expect(body.escrowReports).toEqual(state.snapshot.escrowReports);
    expect(body.verification).toMatchObject({
      self: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
      agent: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
      community: { status: "mixed_per_entry", verifiable: true, proofField: "signed" },
      escrow_report: { status: "verifiable_if_attested", verifiable: true, proofField: "attestationJws" },
    });
    expect(body.verification.community.reason).toContain("signed: true");
    expect(body.governance).toEqual({ enabled: false });
    expect(body.projection.svri).toEqual({ version: "1.0", publicLevel: "pending" });
    expect(body.projection.svri.score).toBeUndefined();
    expect(body.projection.svri.t1Count).toBeUndefined();
    expect(body.projection.svri).toEqual({ version: "1.0", publicLevel: "pending" });
    expect(body.projection.svri.score).toBeUndefined();
  });

  it("responde 400 sin siteId", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_site_id" });
  });

  it("no expone voterId ni ipHash de las filas community (privacidad)", async () => {
    // ipHash es un artefacto interno de rate-limit y voterId un UUID anonimo
    // del navegador. Ninguno es dato de protocolo (6.6 publica puntaje, conteo
    // y suma de pesos; A.6 nunca los nombra). Se depuran de toda respuesta
    // publica: sin esto, cualquiera podia enumerar votantes, correlacionarlos
    // entre sitios, y revertir la IP por fuerza bruta contra el espacio IPv4
    // si el salt era debil.
    state.snapshot.community = [
      {
        siteId: "ejemplo.com",
        category: "content_accuracy",
        score: 4,
        comment: "ok",
        voterId: "anon-abc",
        ipHash: "deadbeef",
        votedAt: "2026-10-15T00:00:00.000Z",
      },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(raw).not.toContain("anon-abc");
    expect(raw).not.toContain("deadbeef");
    expect(body.community[0].voterId).toBeUndefined();
    expect(body.community[0].ipHash).toBeUndefined();

    // Lo que si es dato de protocolo sigue publico.
    expect(body.community[0].category).toBe("content_accuracy");
    expect(body.community[0].score).toBe(4);
    expect(body.community[0].comment).toBe("ok");
    expect(body.community[0].signed).toBe(false);
  });
});

// Phase 1 (content negotiation): la Function tapaba la UI de
// SiteTrustScore en self-host y Cloudflare Pages (funciones antes que
// assets) y un humano veia JSON crudo. Con Accept: text/html la function
// sirve el shell estatico /trust/ via env.ASSETS (binding existente en
// ambas plataformas); la URL del navegador sigue siendo /trust/<siteId>
// y el shell lee el siteId del pathname.
describe("GET /trust/:siteId: negociacion HTML vs JSON", () => {
  function htmlRequest() {
    return new Request("http://x.test/trust/ejemplo.com", {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
  }

  it("Accept text/html + env.ASSETS: sirve el shell /trust/ como HTML", async () => {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    const asked: string[] = [];
    const res = await onRequestGet({
      env: {
        ASSETS: {
          fetch: async (input: any) => {
            asked.push(String(input instanceof Request ? input.url : input));
            return new Response("<html><body>trust shell</body></html>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          },
        },
      },
      params: { siteId: "ejemplo.com" },
      request: htmlRequest(),
      data: {},
    });
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("trust shell");
    // Pide el shell generico /trust/, no el asset por siteId (no existe).
    expect(asked.some((u) => u.endsWith("/trust/"))).toBe(true);
  });

  it("Accept text/html pero el shell no existe (ASSETS 404): responde JSON", async () => {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    const res = await onRequestGet({
      env: {
        ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
      },
      params: { siteId: "ejemplo.com" },
      request: htmlRequest(),
      data: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("Accept text/html SIN env.ASSETS: responde JSON como antes (deploy sin binding)", async () => {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    const res = await onRequestGet({
      env: {},
      params: { siteId: "ejemplo.com" },
      request: htmlRequest(),
      data: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("Accept application/json (agentes): sigue siendo el JSON del snapshot", async () => {
    const { onRequestGet } = await import("../../functions/trust/[siteId].js");
    const res = await onRequestGet({
      env: {
        ASSETS: {
          fetch: async () => {
            throw new Error("no debe delegar para clientes JSON");
          },
        },
      },
      params: { siteId: "ejemplo.com" },
      request: new Request("http://x.test/trust/ejemplo.com", { headers: { accept: "application/json" } }),
      data: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.siteId).toBe("ejemplo.com");
    expect(body.verification).toBeTruthy();
  });
});
