// PR H: activacion de pay-per-crawl. Sin key valida no se activa ni el
// permiso ni el proveedor, y el PUT generico no puede activarlo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemorySettlementActivationStore } from "../../packages/trust-layer/src/billing/pay-per-crawl/activation-store";

const state = vi.hoisted(() => ({
  permissions: null as unknown,
  activations: null as unknown,
  identity: { domain: "site.example" } as { domain: string } | null,
}));

vi.mock("../../packages/permissions/src/store-factory.ts", () => ({ createPermissionStore: async () => state.permissions }));
vi.mock("../../packages/trust-layer/src/billing/pay-per-crawl/activation-store.ts", async (orig) => ({
  ...(await orig<object>()),
  createSettlementActivationStore: async () => state.activations,
}));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => ({ get: async () => state.identity }),
}));
vi.mock("../../packages/plugin-sandbox/src/registry/store-factory.ts", () => ({
  createPluginRegistryStore: async () => ({ list: async () => [] }),
}));
vi.mock("../../packages/auth/src/store-factory.ts", () => ({ createUsersStore: async () => ({}), createSessionStore: async () => ({}) }));
vi.mock("../../packages/auth/src/auth-service.ts", () => ({
  AuthService: class {
    async verifyStepUp(_u: string, f: { password?: string }) {
      return f.password === "correcta" ? { ok: true } : { ok: false, reason: "invalid_password" };
    }
  },
}));

const settlement = await import("../../functions/admin/settlement/index.js");
const permissions = await import("../../functions/admin/permissions/index.js");

const ZONE_ID = "0123456789abcdef0123456789abcdef";
// Valor inconfundible: no puede aparecer por casualidad en etiquetas publicas
// ("API token de Cloudflare" contiene "tok" y generaba un falso positivo).
const SECRET_TOKEN = "SECRETO-NO-EXPONER-7f3a9c";
const ENV = { PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: "k".repeat(40) };
const ADMIN = { username: "admin", role: "admin" };

function ctx(body: unknown, user: object | null = ADMIN, env: object = ENV) {
  return { request: new Request("https://site.example/admin/settlement", { method: "POST", body: JSON.stringify(body) }), data: { user }, env };
}
const activateBody = (extra: object = {}) => ({
  action: "activate",
  providerId: "cloudflare-pay-per-crawl",
  credentials: { api_token: SECRET_TOKEN, zone_id: ZONE_ID },
  confirmOriginLocked: true,
  password: "correcta",
  ...extra,
});
function mockCloudflare(zone: object, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: status === 200, result: zone }), { status }));
}
async function billingGrant() {
  const all = await (state.permissions as InMemoryPermissionStore).getAllGrants();
  return all.find((g) => g.capabilityId === "billing:pay-per-crawl");
}

beforeEach(() => {
  state.permissions = new InMemoryPermissionStore();
  state.activations = new InMemorySettlementActivationStore();
  state.identity = { domain: "site.example" };
});
afterEach(() => vi.restoreAllMocks());

describe("POST /admin/settlement activate", () => {
  it("con credenciales verificadas guarda activacion cifrada y concede el grant", async () => {
    const f = mockCloudflare({ name: "site.example", status: "active" });
    const res = await settlement.onRequestPost(ctx(activateBody()));
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledOnce();

    const act = await (state.activations as InMemorySettlementActivationStore).get("cloudflare-pay-per-crawl");
    expect(act?.metadata).toEqual({ zone_id: ZONE_ID, zone_name: "site.example" });
    expect(act?.credentialEnc.startsWith("v1.")).toBe(true);
    expect(act?.credentialEnc).not.toContain(SECRET_TOKEN);
    expect(await billingGrant()).toMatchObject({ granted: true, subject: { type: "settlement-provider", id: "cloudflare-pay-per-crawl" } });
  });

  it("si Cloudflare rechaza el token no se escribe ni la activacion ni el permiso", async () => {
    mockCloudflare({}, 403);
    const res = await settlement.onRequestPost(ctx(activateBody()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "verification_failed", reason: "token_rejected" });
    expect(await (state.activations as InMemorySettlementActivationStore).get("cloudflare-pay-per-crawl")).toBeNull();
    expect(await billingGrant()).toBeUndefined();
  });

  it("zona de otro dominio: no activa", async () => {
    mockCloudflare({ name: "otro.example", status: "active" });
    const res = await settlement.onRequestPost(ctx(activateBody()));
    expect(await res.json()).toMatchObject({ reason: "zone_does_not_match_site" });
    expect(await billingGrant()).toBeUndefined();
  });

  it("exige confirmar el bloqueo del origen, step-up, identidad APW, clave de cifrado y rol admin, sin llamar a Cloudflare", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect((await settlement.onRequestPost(ctx(activateBody({ confirmOriginLocked: false })))).status).toBe(400);
    expect((await settlement.onRequestPost(ctx(activateBody({ password: "mal" })))).status).toBe(401);
    expect((await settlement.onRequestPost(ctx(activateBody(), { username: "v", role: "viewer" }))).status).toBe(403);
    expect((await settlement.onRequestPost(ctx(activateBody(), null))).status).toBe(401);
    expect((await settlement.onRequestPost(ctx(activateBody(), ADMIN, {}))).status).toBe(503);
    state.identity = null;
    const noId = await settlement.onRequestPost(ctx(activateBody()));
    expect(noId.status).toBe(409);
    expect(await noId.json()).toMatchObject({ error: "site_identity_required" });
    expect(f).not.toHaveBeenCalled();
    expect(await billingGrant()).toBeUndefined();
  });

  it("deactivate borra la activacion y revoca el grant", async () => {
    mockCloudflare({ name: "site.example", status: "active" });
    await settlement.onRequestPost(ctx(activateBody()));
    const res = await settlement.onRequestPost(ctx({ action: "deactivate", providerId: "cloudflare-pay-per-crawl" }));
    expect(res.status).toBe(200);
    expect(await (state.activations as InMemorySettlementActivationStore).get("cloudflare-pay-per-crawl")).toBeNull();
    expect(await billingGrant()).toMatchObject({ granted: false });
  });

  it("GET no expone secretos", async () => {
    mockCloudflare({ name: "site.example", status: "active" });
    await settlement.onRequestPost(ctx(activateBody()));
    const res = await settlement.onRequestGet({ data: { user: ADMIN }, env: ENV });
    const text = await res.text();
    expect(text).not.toContain("credentialEnc");
    expect(text).not.toContain(SECRET_TOKEN);
    expect(text).not.toContain("v1.");
    expect(JSON.parse(text)).toMatchObject({ siteHost: "site.example", providers: [{ id: "cloudflare-pay-per-crawl", active: true }] });
  });
});

describe("PUT /admin/permissions no puede activar cobros", () => {
  function put(body: unknown) {
    return permissions.onRequestPut({
      request: new Request("https://site.example/admin/permissions", { method: "PUT", body: JSON.stringify(body) }),
      data: { user: ADMIN },
      env: ENV,
    });
  }

  it("rechaza billing:* y subjects settlement-provider con 409", async () => {
    for (const body of [
      { subject: { type: "settlement-provider", id: "cloudflare-pay-per-crawl", displayName: "CF" }, capabilityId: "billing:pay-per-crawl", granted: true },
      { subject: { type: "plugin", id: "evil", displayName: "Evil" }, capabilityId: "billing:pay-per-crawl", granted: true },
      { subject: { type: "settlement-provider", id: "cloudflare-pay-per-crawl", displayName: "CF" }, capabilityId: "site:admin", granted: true },
    ]) {
      const res = await put(body);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "requires_activation_flow" });
    }
    expect(await billingGrant()).toBeUndefined();
  });

  it("los demas permisos siguen funcionando y el snapshot muestra la fila del proveedor", async () => {
    const res = await put({ subject: { type: "plugin", id: "p", displayName: "P" }, capabilityId: "content:read", granted: true });
    expect(res.status).toBe(200);
    const snap = await (await permissions.onRequestGet({ data: { user: ADMIN }, env: ENV })).json();
    expect(snap.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: "billing:pay-per-crawl", granted: false, subject: expect.objectContaining({ type: "settlement-provider" }) }),
      ])
    );
  });
});
