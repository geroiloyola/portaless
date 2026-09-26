// v0.0.9.28 -- GET /admin/api/product-preview (sesion, validacion y topes).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRegistry } = vi.hoisted(() => ({
  mockRegistry: {
    ProductGrid: {
      renderHTMLAsync: undefined as undefined | ((p: any) => Promise<string>),
    },
  } as any,
}));

vi.mock("../../packages/atomic-elements/src/elements/registry.ts", () => ({ elementRegistry: mockRegistry }));

import { onRequestGet } from "../../functions/admin/api/product-preview.js";

const render = vi.fn(async (p: any) => `<div class="grid">${p.source}:${p.columns}x${p.limit}</div>`);
const user = { username: "admin", role: "admin" };

function call(query: string, withUser = true) {
  return onRequestGet({
    data: withUser ? { user } : {},
    request: new Request(`https://site.test/admin/api/product-preview${query}`),
  } as any);
}

beforeEach(() => {
  render.mockClear();
  mockRegistry.ProductGrid.renderHTMLAsync = render;
});

describe("GET /admin/api/product-preview", () => {
  it("sin sesion responde 401 y no consulta Medusa", async () => {
    const res = await call("?columns=3&limit=6", false);
    expect(res.status).toBe(401);
    expect(render).not.toHaveBeenCalled();
  });

  it("sin query usa 3 columnas y 6 productos", async () => {
    const res = await call("");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ html: '<div class="grid">medusa:3x6</div>' });
  });

  it("respeta valores validos", async () => {
    await call("?columns=2&limit=4");
    expect(render).toHaveBeenCalledWith({ source: "medusa", columns: 2, limit: 4 });
  });

  it.each(["abc", "2.5", "0", "-1"])("columns=%s responde 400", async (v) => {
    const res = await call(`?columns=${v}&limit=6`);
    expect(res.status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it("limit invalido responde 400", async () => {
    expect((await call("?columns=3&limit=1e3")).status).toBe(400);
  });

  it("topea columns en 6 y limit en 24", async () => {
    await call("?columns=99&limit=100000");
    expect(render).toHaveBeenCalledWith({ source: "medusa", columns: 6, limit: 24 });
  });

  it("sin renderHTMLAsync responde 501", async () => {
    mockRegistry.ProductGrid.renderHTMLAsync = undefined;
    expect((await call("?columns=3&limit=6")).status).toBe(501);
  });
});
