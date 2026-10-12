// functions/admin/api/skin.js + functions/api/site-skin.js: el selector
// de apariencia escribe site_skin y el sitio publico lo lee como hoja
// CSS. Cubre: 401/403, invalid_json_body, invalid_skin, invalid_tokens
// (barrera de inyeccion CSS — nunca se guarda basura), happy path
// GET/PUT con persistencia real en SQLite temporal, y que la hoja
// publica refleje el accent nuevo con content-type text/css.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import * as adminSkin from "../../functions/admin/api/skin";
import * as publicSkin from "../../functions/api/site-skin";
import { DEFAULT_TOKENS } from "../../packages/dashboard/src/skin-engine/tokens";

const tmp = mkdtempSync(join(tmpdir(), "portaless-admin-skin-"));
const DB = join(tmp, "portaless.db");

let env: Record<string, unknown>;

beforeAll(async () => {
  // applySchema recibe el PATH (abre y cierra su propia conexion); pasar
  // la instancia Database hacia atras dejaba una promesa rechazada sin
  // manejar ("Expected first argument to be a string") y la base quedaba
  // sin schema -- los stores creaban su tabla via DDL propio.
  await applySchema(DB, { quiet: true });
  env = { PORTALESS_SQLITE_PATH: DB };
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function adminCtx(opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string } = {}) {
  const request = new Request("http://x.test/admin/api/skin", {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    env,
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

function publicCtx() {
  return {
    request: new Request("http://x.test/api/site-skin"),
    env,
    params: {},
    data: {},
    next: async () => new Response("static"),
  } as any;
}

const ADMIN = { username: "admin", role: "admin" };
const VIEWER = { username: "v", role: "viewer" };

describe("GET /admin/api/skin", () => {
  it("401 sin sesion", async () => {
    const res = await adminSkin.onRequestGet(adminCtx({ user: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("con sesion: skin base por defecto + skins disponibles + defaults oficiales", async () => {
    const res = await adminSkin.onRequestGet(adminCtx({ user: VIEWER }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skin).toBe("base");
    expect(body.tokens).toEqual({});
    expect(body.available).toEqual(["base", "blog", "tienda", "trust-crm"]);
    expect(body.defaults.accent).toBe(DEFAULT_TOKENS.accent);
  });
});

describe("PUT /admin/api/skin", () => {
  it("401 sin sesion", async () => {
    const res = await adminSkin.onRequestPut(adminCtx({ user: null, method: "PUT", body: {} }));
    expect(res.status).toBe(401);
  });

  it("403 rol sin permiso de escritura", async () => {
    const res = await adminSkin.onRequestPut(adminCtx({ user: VIEWER, method: "PUT", body: {} }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("400 body que no es JSON", async () => {
    const request = new Request("http://x.test/admin/api/skin", { method: "PUT", body: "no-json" });
    const res = await adminSkin.onRequestPut({
      request, env, params: {}, data: { user: ADMIN }, next: async () => new Response("static"),
    } as any);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json_body");
  });

  it("400 skin desconocido", async () => {
    const res = await adminSkin.onRequestPut(adminCtx({ user: ADMIN, method: "PUT", body: { skin: "hacker" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_skin");
  });

  it("400 tokens con inyeccion CSS: no se guarda nada", async () => {
    const res = await adminSkin.onRequestPut(
      adminCtx({ user: ADMIN, method: "PUT", body: { skin: "base", tokens: { accent: "#fff; } body { display: none" } } })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_tokens");
    expect(body.message).toContain("accent");

    // La fila no quedo basura: GET sigue viendo el default.
    const get = await adminSkin.onRequestGet(adminCtx({ user: ADMIN }));
    expect((await get.json()).tokens).toEqual({});
  });

  it("happy path: guarda skin + tokens y el GET lo refleja; preview resuelve ambos temas", async () => {
    const put = await adminSkin.onRequestPut(
      adminCtx({ user: ADMIN, method: "PUT", body: { skin: "blog", tokens: { accent: "#AABBCC", radius: "8px" } } })
    );
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body.skin).toBe("blog");
    expect(body.tokens.accent).toBe("#AABBCC");
    expect(body.preview.light.accent).toBe("#AABBCC");
    expect(body.preview.dark.accent).toBe("#AABBCC");
    expect(body.preview.dark.bg).toBe("#261C15");

    const get = await adminSkin.onRequestGet(adminCtx({ user: VIEWER }));
    const after = await get.json();
    expect(after.skin).toBe("blog");
    expect(after.tokens.accent).toBe("#AABBCC");
    expect(after.tokens.radius).toBe("8px");
  });
});

describe("GET /api/site-skin (publico)", () => {
  it("200 text/css sin cache, con los bloques claro y oscuro", async () => {
    const res = await publicSkin.onRequestGet(publicCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const css = await res.text();
    expect(css).toContain("html:root {");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain('html:root[data-theme="dark"]');
    expect(css).toContain("--accent:");
  });

  it("refleja el accent guardado por el admin (un solo punto de verdad)", async () => {
    const css = await (await publicSkin.onRequestGet(publicCtx())).text();
    expect(css).toContain("--accent: #AABBCC;");
    expect(css).not.toContain("display: none");
  });
});
