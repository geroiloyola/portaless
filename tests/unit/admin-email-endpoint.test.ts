// functions/admin/api/email.js: el panel de email escribe site_settings
// (proveedor, from, plantillas aprobadas). Cubre 401/403, invalid_json_body,
// invalid_email_settings (400 con la lista rejected -- nunca guarda basura) y
// el happy path GET/PUT con persistencia real en SQLite temporal.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import * as adminEmail from "../../functions/admin/api/email";

const tmp = mkdtempSync(join(tmpdir(), "portaless-admin-email-"));
const DB = join(tmp, "portaless.db");

let env: Record<string, unknown>;

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
  env = { PORTALESS_SQLITE_PATH: DB };
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; method?: string } = {}) {
  const request = new Request("http://x.test/admin/api/email", {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { request, env, params: {}, data: opts.user ? { user: opts.user } : {}, next: async () => new Response("static") } as any;
}

const admin = { username: "admin", role: "admin" };
const viewer = { username: "v", role: "viewer" };

describe("admin email endpoint", () => {
  it("GET sin sesion -> 401", async () => {
    const res = await adminEmail.onRequestGet(ctx());
    expect(res.status).toBe(401);
  });

  it("PUT con rol viewer -> 403", async () => {
    const res = await adminEmail.onRequestPut(ctx({ user: viewer, method: "PUT", body: {} }));
    expect(res.status).toBe(403);
  });

  it("PUT con JSON invalido -> 400", async () => {
    const request = new Request("http://x.test/admin/api/email", { method: "PUT", body: "no-json" });
    const res = await adminEmail.onRequestPut({ request, env, data: { user: admin } } as any);
    expect(res.status).toBe(400);
  });

  it("PUT invalido -> 400 con rejected, sin guardar", async () => {
    const res = await adminEmail.onRequestPut(
      ctx({ user: admin, method: "PUT", body: { provider: { kind: "webhook", url: "http://localhost:1" }, from: "no-email", templates: [{ id: "Bad", subject: "", body: "" }] } })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_email_settings");
    expect(body.rejected.length).toBeGreaterThan(0);
    // No se guardo nada: el GET sigue vacio.
    const get = await (await adminEmail.onRequestGet(ctx({ user: admin }))).json();
    expect(get.provider.kind).toBe("none");
  });

  it("happy path GET/PUT persiste proveedor, from y plantillas", async () => {
    const payload = {
      provider: { kind: "webhook", url: "https://hooks.example.com/send", token: "tok" },
      from: "noreply@mitiendita.cl",
      templates: [{ id: "order_confirmation", subject: "Pedido {{orderId}}", body: "Listo {{orderId}}" }],
    };
    const put = await adminEmail.onRequestPut(ctx({ user: admin, method: "PUT", body: payload }));
    expect(put.status).toBe(200);
    const get = await (await adminEmail.onRequestGet(ctx({ user: admin }))).json();
    expect(get.provider.kind).toBe("webhook");
    expect(get.provider.url).toBe("https://hooks.example.com/send");
    expect(get.from).toBe("noreply@mitiendita.cl");
    expect(get.templates[0].id).toBe("order_confirmation");
    expect(get.available).toEqual(["none", "webhook", "smtp"]);
  });
});
