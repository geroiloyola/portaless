// functions/admin/api/email.js: el panel de email escribe site_settings
// (proveedor, from, plantillas aprobadas). Cubre 401/403, invalid_json_body,
// invalid_email_settings (400 con la lista rejected -- nunca guarda basura),
// el happy path GET/PUT con persistencia real en SQLite temporal, y R3:
// GET solo admin, el token NUNCA sale, y es write-only (conservar/borrar).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import * as adminEmail from "../../functions/admin/api/email";
import { createSiteSettingsStore } from "../../packages/dashboard/src/site-settings/site-settings-store";
import { parseEmailSettings } from "../../packages/email-transport/src/config";

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
  const method = opts.method ?? "GET";
  const request = new Request("http://x.test/admin/api/email", {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: "http://x.test" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { request, env, params: {}, data: opts.user ? { user: opts.user } : {}, next: async () => new Response("static") } as any;
}

const admin = { username: "admin", role: "admin" };
const viewer = { username: "v", role: "viewer" };

async function getJson(user = admin) {
  return (await adminEmail.onRequestGet(ctx({ user }))).json();
}
async function put(body: unknown) {
  return adminEmail.onRequestPut(ctx({ user: admin, method: "PUT", body }));
}
async function storedToken(): Promise<string | undefined> {
  const settings = await parseEmailSettings(await createSiteSettingsStore(env));
  return settings.provider.token;
}

describe("admin email endpoint", () => {
  it("GET sin sesion -> 401", async () => {
    const res = await adminEmail.onRequestGet(ctx());
    expect(res.status).toBe(401);
  });

  it("R3: GET con rol viewer -> 403 (la config incluye credenciales)", async () => {
    const res = await adminEmail.onRequestGet(ctx({ user: viewer }));
    expect(res.status).toBe(403);
  });

  it("PUT con rol viewer -> 403", async () => {
    const res = await adminEmail.onRequestPut(ctx({ user: viewer, method: "PUT", body: {} }));
    expect(res.status).toBe(403);
  });

  it("PUT con JSON invalido -> 400", async () => {
    const request = new Request("http://x.test/admin/api/email", { method: "PUT", headers: { origin: "http://x.test" }, body: "no-json" });
    const res = await adminEmail.onRequestPut({ request, env, data: { user: admin } } as any);
    expect(res.status).toBe(400);
  });

  it("PUT rechaza origen cruzado y cuerpos superiores a 128 KiB", async () => {
    const wrongOrigin = new Request("http://x.test/admin/api/email", {
      method: "PUT",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect((await adminEmail.onRequestPut({ request: wrongOrigin, env, data: { user: admin } } as any)).status).toBe(403);

    const oversized = new Request("http://x.test/admin/api/email", {
      method: "PUT",
      headers: { origin: "http://x.test", "content-type": "application/json" },
      body: `{"templates":"${"x".repeat(129 * 1024)}"}`,
    });
    expect((await adminEmail.onRequestPut({ request: oversized, env, data: { user: admin } } as any)).status).toBe(413);
  });

  it("PUT invalido -> 400 con rejected, sin guardar", async () => {
    const res = await put({ provider: { kind: "webhook", url: "http://localhost:1" }, from: "no-email", templates: [{ id: "Bad", subject: "", body: "" }] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_email_settings");
    expect(body.rejected.length).toBeGreaterThan(0);
    expect((await getJson()).provider.kind).toBe("none"); // no se guardo nada
  });

  it("happy path GET/PUT persiste proveedor, from y plantillas (sin exponer el token)", async () => {
    const payload = {
      provider: { kind: "webhook", url: "https://hooks.example.com/send", token: "tok" },
      from: "noreply@mitiendita.cl",
      templates: [{ id: "order_confirmation", subject: "Pedido {{orderId}}", body: "Listo {{orderId}}" }],
    };
    const putRes = await put(payload);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.provider.token).toBeUndefined();
    expect(putBody.hasCredential).toBe(true);

    const get = await getJson();
    expect(get.provider.kind).toBe("webhook");
    expect(get.provider.url).toBe("https://hooks.example.com/send");
    expect(get.provider.token).toBeUndefined(); // R3: nunca sale
    expect(get.hasCredential).toBe(true);
    expect(get.from).toBe("noreply@mitiendita.cl");
    expect(get.templates[0].id).toBe("order_confirmation");
    expect(get.available).toEqual(["none", "webhook", "smtp"]);
    expect(await storedToken()).toBe("tok");
  });

  it("R3: PUT con token vacio CONSERVA el guardado", async () => {
    await put({ provider: { kind: "webhook", url: "https://hooks.example.com/send" }, from: "noreply@mitiendita.cl", templates: [] });
    expect(await storedToken()).toBe("tok");
    expect((await getJson()).hasCredential).toBe(true);
  });

  it("R3: PUT con token nuevo lo reemplaza", async () => {
    await put({ provider: { kind: "webhook", url: "https://hooks.example.com/send", token: "nuevo" }, from: "noreply@mitiendita.cl" });
    expect(await storedToken()).toBe("nuevo");
  });

  it("R3: PUT con clearCredential borra la credencial", async () => {
    await put({ provider: { kind: "webhook", url: "https://hooks.example.com/send", clearCredential: true }, from: "noreply@mitiendita.cl" });
    expect(await storedToken()).toBeUndefined();
    expect((await getJson()).hasCredential).toBe(false);
  });
});
