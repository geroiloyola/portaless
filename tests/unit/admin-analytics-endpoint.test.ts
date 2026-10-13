// functions/admin/api/analytics.js + functions/api/analytics.js: el panel de
// analytics escribe site_settings y el sitio publico lo lee como
// /api/analytics. Cubre: 401/403, invalid_json_body, invalid_analytics
// (400 con la lista rejected -- nunca se guarda basura), happy path
// GET/PUT con persistencia real en SQLite temporal, y que el asset publico
// emita el beacon de Cloudflare con el token configurado.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import * as adminAnalytics from "../../functions/admin/api/analytics";
import * as publicAnalytics from "../../functions/api/analytics";

const tmp = mkdtempSync(join(tmpdir(), "portaless-admin-analytics-"));
const DB = join(tmp, "portaless.db");

let env: Record<string, unknown>;

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  env = { PORTALESS_SQLITE_PATH: DB };
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function adminCtx(opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string } = {}) {
  const request = new Request("http://x.test/admin/api/analytics", {
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

function publicCtx(options: { env?: Record<string, unknown>; nextBody?: string } = {}) {
  let nextCalled = 0;
  const context = {
    request: new Request("http://x.test/api/analytics"),
    env: options.env ?? env,
    params: {},
    data: {},
    next: async () => {
      nextCalled += 1;
      return new Response(options.nextBody ?? "/* static */", { status: 200 });
    },
  } as any;
  return { context, nextCalls: () => nextCalled };
}

const ADMIN = { username: "admin", role: "admin" };

describe("GET /admin/api/analytics", () => {
  it("401 sin sesion", async () => {
    const res = await adminAnalytics.onRequestGet(adminCtx({ user: null }));
    expect(res.status).toBe(401);
  });

  it("devuelve la config vacia y los proveedores disponibles", async () => {
    const res = await adminAnalytics.onRequestGet(adminCtx({ user: ADMIN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("none");
    expect(body.available).toContain("plausible");
    expect(body.available).toContain("custom");
  });
});

describe("PUT /admin/api/analytics", () => {
  it("403 si el rol no es admin (nunca escribe)", async () => {
    const res = await adminAnalytics.onRequestPut(
      adminCtx({ user: { username: "editor", role: "editor" }, body: { provider: "plausible", id: "a.com" }, method: "PUT" })
    );
    expect(res.status).toBe(403);
    const stored = await adminAnalytics.onRequestGet(adminCtx({ user: ADMIN }));
    expect((await stored.json()).provider).toBe("none");
  });

  it("400 con cuerpo que no es JSON", async () => {
    const request = new Request("http://x.test/admin/api/analytics", { method: "PUT", body: "no-json" });
    const res = await adminAnalytics.onRequestPut({
      request,
      env,
      params: {},
      data: { user: ADMIN },
      next: async () => new Response("static"),
    } as any);
    expect(res.status).toBe(400);
  });

  it("400 con id inseguro y la lista rejected (no persiste nada)", async () => {
    const res = await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "plausible", id: '"><script>' }, method: "PUT" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_analytics");
    expect(body.message).toContain("id");
    const stored = await adminAnalytics.onRequestGet(adminCtx({ user: ADMIN }));
    expect((await stored.json()).provider).toBe("none");
  });

  it("400 si el proveedor no existe", async () => {
    const res = await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "ga4", id: "x" }, method: "PUT" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("provider");
  });

  it("happy path: guardar plausible y leerlo de vuelta", async () => {
    const put = await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "plausible", id: "ejemplo.com" }, method: "PUT" })
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      provider: "plausible",
      id: "ejemplo.com",
      scriptUrl: "https://plausible.io/js/script.js",
    });

    const get = await adminAnalytics.onRequestGet(adminCtx({ user: ADMIN }));
    expect((await get.json()).provider).toBe("plausible");
  });

  it("custom exige https; none limpia la config", async () => {
    const bad = await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "custom", id: "", scriptUrl: "javascript:alert(1)" }, method: "PUT" })
    );
    expect(bad.status).toBe(400);

    const off = await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "none", id: "", scriptUrl: "" }, method: "PUT" })
    );
    expect(off.status).toBe(200);
    expect((await off.json()).provider).toBe("none");
  });
});

describe("GET /api/analytics (runtime publico)", () => {
  it("emite el beacon de Cloudflare con el token configurado", async () => {
    await adminAnalytics.onRequestPut(
      adminCtx({ user: ADMIN, body: { provider: "cloudflare", id: "token-abc" }, method: "PUT" })
    );
    const { context, nextCalls } = publicCtx();
    const res = await publicAnalytics.onRequestGet(context);
    expect(nextCalls()).toBe(0);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    const js = await res.text();
    expect(js).toContain("static.cloudflareinsights.com/beacon.min.js");
    expect(js).toContain("token-abc");
    // Limpia para los tests siguientes.
    await adminAnalytics.onRequestPut(adminCtx({ user: ADMIN, body: { provider: "none" }, method: "PUT" }));
  });

  it("sin config emite el no-op, sin llamar a next()", async () => {
    const { context, nextCalls } = publicCtx();
    const res = await publicAnalytics.onRequestGet(context);
    expect(nextCalls()).toBe(0);
    expect(await res.text()).toContain("sin analytics configurado");
  });

  it("si la base no esta disponible delega al build estatico", async () => {
    const { context, nextCalls } = publicCtx({ env: { PORTALESS_SQLITE_PATH: join(tmp, "no", "mkdirs", "x.db") } });
    const res = await publicAnalytics.onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(await res.text()).toBe("/* static */");
  });

  it("fila invalida en la base (plausible sin id) se ignora y sirve el no-op", async () => {
    // Regresion: el sanitizer bloquea el id vacio al ESCRIBIR, pero una fila
    // tocada a mano (o de una version vieja) puede tener proveedor sin id.
    // parseAnalyticsSettings revalida al leer: sin id no hay nada que cargar
    // y el asset debe ser el no-op, no un beacon roto.
    const { createSiteSettingsStore } = await import(
      "../../packages/dashboard/src/site-settings/site-settings-store"
    );
    const store = await createSiteSettingsStore(env as any);
    await store.setMany({ analytics_provider: "plausible", analytics_id: "", analytics_script_url: "" });

    const { context, nextCalls } = publicCtx();
    const res = await publicAnalytics.onRequestGet(context);
    expect(nextCalls()).toBe(0);
    expect(await res.text()).toContain("sin analytics configurado");

    await store.setMany({ analytics_provider: "none", analytics_id: "", analytics_script_url: "" });
  });
});
