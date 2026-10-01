import { describe, expect, it, vi } from "vitest";
import { loadContentPolicy } from "../../packages/trust-layer/src/policy/load-policy.ts";
import { defaultContentPolicy } from "../../packages/trust-layer/src/policy/manifest-schema.ts";

const ORIGIN = "https://a.com";

function assetsReturning(body: unknown, status = 200) {
  return {
    fetch: vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    ),
  };
}

const custom = {
  version: "0.1",
  site: ORIGIN,
  policies: {
    search: { access: "allow" },
    ai_input: { access: "block" },
    ai_train: { access: "block" },
  },
};

describe("loadContentPolicy", () => {
  it("sin binding ASSETS usa la politica por defecto", async () => {
    expect(await loadContentPolicy(ORIGIN)).toEqual(defaultContentPolicy(ORIGIN));
  });

  it("lee el manifiesto publicado por la URL de .well-known", async () => {
    const assets = assetsReturning(custom);
    const policy = await loadContentPolicy(ORIGIN, assets);
    expect(policy.policies.ai_input.access).toBe("block");
    const req = assets.fetch.mock.calls[0][0] as Request;
    expect(req.url).toBe("https://a.com/.well-known/portaless-content-policy.json");
  });

  it("vuelve a la politica por defecto si el archivo no existe", async () => {
    expect(await loadContentPolicy(ORIGIN, assetsReturning("no", 404))).toEqual(defaultContentPolicy(ORIGIN));
  });

  it("vuelve a la politica por defecto si el JSON es invalido o esta incompleto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadContentPolicy(ORIGIN, assetsReturning("{no es json"))).toEqual(defaultContentPolicy(ORIGIN));
    expect(
      await loadContentPolicy(ORIGIN, assetsReturning({ version: "0.1", site: ORIGIN, policies: {} }))
    ).toEqual(defaultContentPolicy(ORIGIN));
    expect(
      await loadContentPolicy(ORIGIN, assetsReturning({ ...custom, policies: { ...custom.policies, ai_input: { access: "maybe" } } }))
    ).toEqual(defaultContentPolicy(ORIGIN));
    warn.mockRestore();
  });
});
