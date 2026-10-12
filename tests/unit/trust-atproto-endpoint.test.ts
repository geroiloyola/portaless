// functions/trust/atproto/[handle].js: el join PUBLICO del puente
// APW <-> AT. buildAtprotoReputation se mockea (el handler no inyecta
// nada); se verifica el contrato HTTP: 400 para sintaxis/TPD reservados,
// 404 para lo que no resuelve, 502 para upstream caido, 200 con el join
// completo, y los headers (CORS * + cache corto, igual que /trust/:siteId).

import { describe, it, expect, vi, beforeEach } from "vitest";

const build = vi.hoisted(() => vi.fn());
vi.mock("../../packages/identity-atproto/src/reputation", () => ({
  buildAtprotoReputation: build,
}));

import { onRequestGet } from "../../functions/trust/atproto/[handle].js";

function context(handle?: string) {
  return { params: { handle }, env: { some: "env" } } as any;
}

function unresolved(reason: string, handle = "nope") {
  return {
    handle,
    resolved: false,
    reason,
    apw: null,
    user: null,
    resolvedAt: "2026-10-12T00:00:00.000Z",
    limitations: [],
  };
}

beforeEach(() => {
  build.mockReset();
});

describe("GET /trust/atproto/:handle", () => {
  it("400 para handle invalido o TLD reservado, con cache corta y CORS", async () => {
    build.mockResolvedValueOnce(unresolved("invalid_handle", "nope"));
    const bad = await onRequestGet(context("nope"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_handle", handle: "nope" });
    expect(bad.headers.get("cache-control")).toBe("public, max-age=60");
    expect(bad.headers.get("access-control-allow-origin")).toBe("*");

    build.mockResolvedValueOnce(unresolved("reserved_tld", "user.test"));
    expect((await onRequestGet(context("user.test"))).status).toBe(400);
  });

  it("404 cuando el handle no resuelve o el link no cierra", async () => {
    for (const reason of ["handle_unresolvable", "ambiguous_txt", "link_mismatch", "did_not_found"]) {
      build.mockResolvedValueOnce(unresolved(reason));
      expect((await onRequestGet(context("x.test.com"))).status).toBe(404);
    }
    // motivo desconocido -> 404 por defecto (nunca 500)
    build.mockResolvedValueOnce(unresolved("algo_nuevo"));
    expect((await onRequestGet(context("x.test.com"))).status).toBe(404);
  });

  it("502 cuando el upstream de resolucion esta caido", async () => {
    for (const reason of ["upstream_error", "did_unreachable", "malformed_document", "did_mismatch"]) {
      build.mockResolvedValueOnce(unresolved(reason));
      expect((await onRequestGet(context("x.test.com"))).status).toBe(502);
    }
  });

  it("200 con el join completo, cache 300 y CORS", async () => {
    const join = {
      handle: "username.wikipedia.org",
      resolved: true,
      identity: { did: "did:plc:abc", didMethod: "plc", resolvedBy: "txt", claimedHandles: [], hasSigningKey: true, pds: null },
      apw: null,
      user: { status: "no_data", reason: "reader_conduct_history_unverified" },
      resolvedAt: "2026-10-12T00:00:00.000Z",
      limitations: ["x"],
    };
    build.mockResolvedValueOnce(join);

    const res = await onRequestGet(context("username.wikipedia.org"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(join);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(build).toHaveBeenCalledWith("username.wikipedia.org", { env: { some: "env" } });
  });

  it("params.handle ausente llega tal cual al builder (que responde invalido)", async () => {
    build.mockResolvedValueOnce(unresolved("invalid_handle", ""));
    expect((await onRequestGet({ params: {}, env: {} } as any)).status).toBe(400);
    expect(build).toHaveBeenCalledWith(undefined, { env: {} });
  });
});
