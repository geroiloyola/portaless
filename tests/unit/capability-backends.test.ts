// Los backends reales de capacidades no-red (Fase 14, §14.2). Fuente unica del
// CapabilityHostBridge que consumen el bridge HTTP (adaptadores edge) y el
// caller de produccion (adaptador self-hosted). Aqui se prueba el bridge en
// proceso: storage con namespace + cuotas, content, y el enrutado por id.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCapabilityHostBridge,
  dispatchCapability,
  hasCapabilityBackend,
  CAPABILITY_BACKENDS,
  notConfigured,
} from "../../packages/plugin-sandbox/src/capabilities/capability-backends";
import { __resetPluginStorageStoreForTests } from "../../packages/plugin-sandbox/src/registry/plugin-storage";
import { createUsageLedgerStore } from "../../packages/trust-layer/src/ledger/store-factory";
import type { CapabilityError } from "../../packages/plugin-sandbox/src/capabilities/capability-backends";

const tmp = mkdtempSync(join(tmpdir(), "portaless-cap-backends-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => __resetPluginStorageStoreForTests());

describe("createCapabilityHostBridge: storage", () => {
  it("write + read ida y vuelta", async () => {
    const bridge = createCapabilityHostBridge({});
    await bridge.storageWrite!("mi-plugin", { key: "config", value: { theme: "dark" } });
    const read = await bridge.storageRead!("mi-plugin", { key: "config" });
    expect(read).toMatchObject({ key: "config", value: { theme: "dark" }, found: true });
  });

  it("leer una clave que no existe devuelve found:false (no lanza)", async () => {
    const bridge = createCapabilityHostBridge({});
    expect(await bridge.storageRead!("mi-plugin", { key: "no-existe" })).toEqual({
      key: "no-existe",
      value: null,
      found: false,
    });
  });

  it("el pluginName es el namespace: el mismo key en otro plugin no se ve", async () => {
    const bridge = createCapabilityHostBridge({});
    await bridge.storageWrite!("plugin-a", { key: "k", value: "de-a" });
    const other = await bridge.storageRead!("plugin-b", { key: "k" });
    expect(other).toMatchObject({ found: false, value: null });
  });

  it("clave invalida propaga el PluginStorageError con su codigo", async () => {
    const bridge = createCapabilityHostBridge({});
    await expect(bridge.storageWrite!("mi-plugin", { key: "no vale!", value: 1 })).rejects.toMatchObject({
      code: "STORAGE_INVALID_KEY",
    });
  });

  it("args mal formados -> NOT_CONFIGURED", async () => {
    const bridge = createCapabilityHostBridge({});
    await expect(bridge.storageRead!("mi-plugin", {} as never)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(bridge.storageWrite!("mi-plugin", { key: "k" } as never)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });
});

describe("createCapabilityHostBridge: content (validacion de forma)", () => {
  it("sin slug -> NOT_CONFIGURED (no toca ningun store)", async () => {
    const bridge = createCapabilityHostBridge({});
    await expect(bridge.contentRead!({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(bridge.contentWrite!({})).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("pagina inexistente -> PAGE_NOT_FOUND, no NOT_CONFIGURED (el backend existe, la pagina no)", async () => {
    const bridge = createCapabilityHostBridge({ PORTALESS_SQLITE_PATH: join(tmp, "pages.sqlite") });
    await expect(bridge.contentRead!({ slug: "no-existe-jamas" })).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
  });
});

describe("createCapabilityHostBridge: agent:identify (ledger de uso)", () => {
  function currentPeriod(): string {
    const n = new Date();
    return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  it("agrega por operador y devuelve solo campos publicos", async () => {
    const db = join(tmp, `ledger-${Math.random().toString(36).slice(2)}.db`);
    const ledger = await createUsageLedgerStore({ PORTALESS_SQLITE_PATH: db });
    const p = currentPeriod();
    await ledger.put(p, {
      period: p,
      generatedAt: new Date().toISOString(),
      agents: [
        { operatorKeyId: "ed25519:a", operatorNameClaimed: "A", readerDid: "did:apw:r.example", requestsTotal: 3, requestsCharged: 0, requestsFreeTier: 3, revenueUsd: 0, policyViolationsDetected: 0, firstSeen: "2026-10-01T00:00:00.000Z", lastSeen: "2026-10-02T00:00:00.000Z" },
        { operatorKeyId: "ed25519:b", requestsTotal: 9, requestsCharged: 0, requestsFreeTier: 9, revenueUsd: 0, policyViolationsDetected: 1, firstSeen: "2026-10-05T00:00:00.000Z", lastSeen: "2026-10-06T00:00:00.000Z" },
      ],
    });
    const bridge = createCapabilityHostBridge({ PORTALESS_SQLITE_PATH: db });
    const result = (await bridge.agentIdentify!({ months: 3, limit: 50 })) as any;
    // Ordenado por requestsTotal desc.
    expect(result.agents.map((a: any) => a.operatorKeyId)).toEqual(["ed25519:b", "ed25519:a"]);
    expect(result.agents[1]).toMatchObject({
      operatorKeyId: "ed25519:a",
      operatorNameClaimed: "A",
      readerDid: "did:apw:r.example",
      requestsTotal: 3,
    });
    // Allowlist: nunca mas campos que los ya publicos.
    expect(Object.keys(result.agents[0]).sort()).toEqual([
      "firstSeen",
      "lastSeen",
      "operatorKeyId",
      "policyViolationsDetected",
      "requestsCharged",
      "requestsFreeTier",
      "requestsTotal",
      "revenueUsd",
    ]);
    expect(result.periodsCovered).toHaveLength(3);
  });

  it("ledger vacio -> agents:[] (estado valido, no error)", async () => {
    const bridge = createCapabilityHostBridge({ PORTALESS_SQLITE_PATH: join(tmp, "ledger-empty.sqlite") });
    const result = (await bridge.agentIdentify!({})) as any;
    expect(result.agents).toEqual([]);
    expect(result.periodsCovered).toHaveLength(3);
  });

  it("args invalidos -> INVALID_ARGS", async () => {
    const bridge = createCapabilityHostBridge({});
    await expect(bridge.agentIdentify!({ months: 0 })).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(bridge.agentIdentify!({ limit: 999 })).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});

describe("dispatchCapability: enruta por id al handler correcto", () => {
  it("storage:read pasa (pluginName, args) -- respeta el namespace", async () => {
    const bridge = createCapabilityHostBridge({});
    await dispatchCapability("storage:write", { key: "k", value: 7 }, bridge, "plugin-alpha");
    const read = await dispatchCapability("storage:read", { key: "k" }, bridge, "plugin-alpha");
    expect(read).toMatchObject({ key: "k", value: 7, found: true });
    const cross = await dispatchCapability("storage:read", { key: "k" }, bridge, "plugin-beta");
    expect(cross).toMatchObject({ found: false });
  });

  it("capacidad concedida sin backend real -> NOT_CONFIGURED (media:read)", async () => {
    const bridge = createCapabilityHostBridge({});
    await expect(dispatchCapability("media:read", {}, bridge, "p")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("CAPABILITY_BACKENDS es la fuente de verdad de que tiene backend", () => {
  it("incluye content:*/storage:*/agent:identify y excluye las que siguen en 501", () => {
    expect(hasCapabilityBackend("storage:read")).toBe(true);
    expect(hasCapabilityBackend("storage:write")).toBe(true);
    expect(hasCapabilityBackend("content:read")).toBe(true);
    expect(hasCapabilityBackend("agent:identify")).toBe(true);
    expect(hasCapabilityBackend("media:read")).toBe(false);
    expect(hasCapabilityBackend("email:send")).toBe(false);
    expect(CAPABILITY_BACKENDS.map((b) => b.id).sort()).toEqual([
      "agent:identify",
      "content:read",
      "content:write",
      "storage:read",
      "storage:write",
    ]);
  });

  it("notConfigured produce un error con code NOT_CONFIGURED", () => {
    const err = notConfigured("x") as CapabilityError;
    expect(err.code).toBe("NOT_CONFIGURED");
  });
});
