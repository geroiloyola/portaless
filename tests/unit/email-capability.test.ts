// TASK 5: email:send con Delegacion Ciega. El plugin solo aporta
// { template, to, data }; el core decide plantillas aprobadas, inyecta el
// `from` del sitio y aplica cuota diaria por plugin.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapabilityHostBridge } from "../../packages/plugin-sandbox/src/capabilities/capability-backends";
import {
  createPluginEmailQuotaStore,
  EmailQuotaStoreUnavailable,
  InMemoryPluginEmailQuotaStore,
} from "../../packages/plugin-sandbox/src/registry/plugin-email-quota";
import {
  EMAIL_KEYS,
  emailSettingsToValues,
  isSafeEmailUrl,
  parseEmailSettings,
  renderEmailTemplate,
  sanitizeEmailInput,
} from "../../packages/email-transport/src/config";
import { createSiteSettingsStore } from "../../packages/dashboard/src/site-settings/site-settings-store";
import { applySchema } from "../../scripts/setup.mjs";

const cleanup: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-email-"));
  cleanup.push(dir);
  return join(dir, "db.sqlite");
}

const APPROVED = { provider: { kind: "webhook", url: "https://hooks.example.com/send" }, from: "noreply@mitiendita.cl", templates: [{ id: "order_confirmation", subject: "Pedido {{orderId}} confirmado", body: "Hola, tu pedido {{orderId}} esta listo." }] };

async function seededBridge(dbPath: string, extraEnv: Record<string, unknown> = {}) {
  await applySchema(dbPath, { quiet: true });
  const store = await createSiteSettingsStore({ PORTALESS_SQLITE_PATH: dbPath });
  await store.setMany(emailSettingsToValues(sanitizeEmailInput(APPROVED).settings));
  const bridge = createCapabilityHostBridge({ PORTALESS_SQLITE_PATH: dbPath, ...extraEnv });
  return bridge;
}

describe("email-config (pura)", () => {
  it("sanitiza proveedor, plantillas y from; rechaza lo invalido", () => {
    const ok = sanitizeEmailInput(APPROVED);
    expect(ok.rejected).toEqual([]);
    expect(ok.settings.from).toBe("noreply@mitiendita.cl");
    expect(ok.settings.templates[0].id).toBe("order_confirmation");

    const bad = sanitizeEmailInput({
      provider: { kind: "webhook", url: "http://localhost:9999" },
      from: "no-es-email",
      templates: [{ id: "Bad ID", subject: "", body: "" }, { id: "dup", subject: "s", body: "b" }, { id: "dup", subject: "s", body: "b" }],
    });
    expect(bad.rejected.length).toBeGreaterThanOrEqual(4);
    expect(bad.settings.provider.kind).toBe("none");
  });

  it("renderiza {{var}} y cae a cadena vacia (nunca 'undefined')", () => {
    const t = { id: "x", subject: "Hola {{name}}", body: "Pedido {{orderId}} de {{name}}" };
    expect(renderEmailTemplate(t, { name: "Ana", orderId: 42 })).toEqual({ subject: "Hola Ana", text: "Pedido 42 de Ana" });
    expect(renderEmailTemplate(t, {}).subject).toBe("Hola ");
  });

  it("parseEmailSettings lee y valida desde el store", async () => {
    const store = { get: async (k: string) => (k === EMAIL_KEYS.provider ? JSON.stringify(APPROVED.provider) : k === EMAIL_KEYS.from ? APPROVED.from : JSON.stringify(APPROVED.templates)) };
    const settings = await parseEmailSettings(store);
    expect(settings.provider.kind).toBe("webhook");
    expect(settings.from).toBe("noreply@mitiendita.cl");
  });
});

describe("plugin-email-quota", () => {
  it("InMemory: consume hasta el tope y luego deniega", async () => {
    const q = new InMemoryPluginEmailQuotaStore();
    expect((await q.consume("p", "2026-10-18", 2)).allowed).toBe(true);
    expect((await q.consume("p", "2026-10-18", 2)).allowed).toBe(true);
    const third = await q.consume("p", "2026-10-18", 2);
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(2);
    // otro plugin tiene su propia cuota
    expect((await q.consume("otro", "2026-10-18", 2)).allowed).toBe(true);
  });

  it("SQLite: atomico y persistente", async () => {
    const db = tempDb();
    const q = await createPluginEmailQuotaStore({ PORTALESS_SQLITE_PATH: db });
    expect((await q.consume("p", "2026-10-18", 1)).allowed).toBe(true);
    expect((await q.consume("p", "2026-10-18", 1)).allowed).toBe(false);
  });
});

describe("email:send -- delegacion ciega", () => {
  it("INVALID_ARGS: template/to con forma invalida", async () => {
    const bridge = await seededBridge(tempDb());
    await expect(bridge.emailSend!("p", { template: "Bad ID", to: "a@b.cl" })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(bridge.emailSend!("p", { template: "order_confirmation", to: "no-email" })).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("EMAIL_BACKEND_NOT_CONFIGURED sin proveedor", async () => {
    const db = tempDb();
    await applySchema(db, { quiet: true });
    const bridge = createCapabilityHostBridge({ PORTALESS_SQLITE_PATH: db });
    await expect(bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl" })).rejects.toMatchObject({ code: "EMAIL_BACKEND_NOT_CONFIGURED" });
  });

  it("EMAIL_TEMPLATE_NOT_APPROVED: el plugin no puede inventar plantillas", async () => {
    const bridge = await seededBridge(tempDb());
    await expect(bridge.emailSend!("p", { template: "spam_masivo", to: "a@b.cl" })).rejects.toMatchObject({ code: "EMAIL_TEMPLATE_NOT_APPROVED" });
  });

  it("fail-closed: RECHAZA campos no permitidos (from/cc/bcc) en vez de ignorarlos", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const bridge = await seededBridge(tempDb());
    const injected = [
      { from: "spam@otro.cl" },
      { cc: "x@y.cl" },
      { bcc: "z@y.cl" },
      { reply_to: "r@y.cl" },
      { sender: "s@y.cl" },
      { foo: "bar" },
    ];
    for (const extra of injected) {
      await expect(
        bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl", ...extra }),
      ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    }
    // Un intento de inyeccion NO llega a la red.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fail-closed: un payload que no es objeto se rechaza", async () => {
    const bridge = await seededBridge(tempDb());
    for (const bad of ["hola", [], null, 42]) {
      await expect(bridge.emailSend!("p", bad as never)).rejects.toMatchObject({ code: "INVALID_ARGS" });
    }
  });

  it("happy path: inyecta el `from` del sitio (el plugin no lo aporta) y devuelve remainingToday", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const bridge = await seededBridge(tempDb());
    const result = await bridge.emailSend!("mi-plugin", { template: "order_confirmation", to: "cliente@ejemplo.cl", data: { orderId: 7 } });
    expect(result).toMatchObject({ sent: true, template: "order_confirmation" });
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.from).toBe("noreply@mitiendita.cl"); // del sitio, siempre
    expect(sent.to).toBe("cliente@ejemplo.cl");
    expect(sent.subject).toBe("Pedido 7 confirmado");
  });

  it("EMAIL_QUOTA_EXCEEDED tras el tope diario por plugin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const bridge = await seededBridge(tempDb(), { PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT: "2" });
    await bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl", data: { orderId: 1 } });
    await bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl", data: { orderId: 2 } });
    await expect(bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl", data: { orderId: 3 } })).rejects.toMatchObject({ code: "EMAIL_QUOTA_EXCEEDED" });
  });

  it("EMAIL_SEND_FAILED si el proveedor responde no-2xx (nunca exito silencioso)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const bridge = await seededBridge(tempDb());
    await expect(bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl" })).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });
  });
});

// R4: la cuota solo debe penalizar envios REALES. Si el transporte falla, el
// cupo del dia se devuelve (el operador puede reintentar).
describe("R4: la cuota no penaliza envios que fallaron", () => {
  it("release devuelve el cupo y nunca baja de 0", async () => {
    const q = new InMemoryPluginEmailQuotaStore();
    await q.consume("p", "2026-10-18", 5);
    expect(await q.release("p", "2026-10-18")).toBe(0);
    expect(await q.release("p", "2026-10-18")).toBe(0); // no negativo
  });

  it("un envio fallido no consume cuota: el reintento cabe", async () => {
    const dbPath = tempDb();
    const bridge = await seededBridge(dbPath, { PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT: "2" });
    const q = await createPluginEmailQuotaStore({ PORTALESS_SQLITE_PATH: dbPath });
    const day = new Date().toISOString().slice(0, 10);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl" })).rejects.toMatchObject({
      code: "EMAIL_SEND_FAILED",
    });
    expect(await q.count("p", day)).toBe(0); // el fallo no consumio

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl" });
    await bridge.emailSend!("p", { template: "order_confirmation", to: "a@b.cl" });
    expect(await q.count("p", day)).toBe(2);
  });
});

// R5: sin backend de BD la cuota no es global -> fail-closed. El handler mapea
// EmailQuotaStoreUnavailable a EMAIL_QUOTA_BACKEND_UNAVAILABLE (bridge -> 501).
describe("R5: cuota fail-closed sin backend persistente", () => {
  it("createPluginEmailQuotaStore sin DB ni SQLite lanza (no cae a InMemory)", async () => {
    await expect(createPluginEmailQuotaStore({})).rejects.toBeInstanceOf(EmailQuotaStoreUnavailable);
  });
});

// R7: isSafeEmailUrl bloquea hosts internos/reservados (SSRF). No cubre
// DNS-rebinding (defense-in-depth); el admin es el unico que configura esto.
describe("R7: SSRF en la URL del webhook", () => {
  it("rechaza loopback, privadas, link-local/metadata y esquemas no http(s)", () => {
    const bad = [
      "http://localhost/send", "http://127.0.0.1/send", "http://0.0.0.0/send",
      "http://10.1.2.3/send", "http://172.16.0.1/send", "http://192.168.1.1/send",
      "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/send",
      "http://[::1]/send", "http://[fe80::1]/send", "http://[fd00::1]/send",
      "http://foo.internal/send", "http://svc.local/send", "ftp://hooks.example.com/x",
      "not-a-url",
    ];
    for (const url of bad) expect(isSafeEmailUrl(url), url).toBe(false);
  });

  it("acepta una URL publica https/http", () => {
    expect(isSafeEmailUrl("https://hooks.example.com/send")).toBe(true);
    expect(isSafeEmailUrl("http://api.resend.com/emails")).toBe(true);
  });
});
