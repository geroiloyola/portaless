// El caller de produccion (runPluginInProduction) ensambla el mismo
// circuito completo que en produccion: permisos reales (concedido ∩
// pedido), adaptador resuelto del registry edge, runtime via
// createSandboxRuntime() y el MISMO CapabilityTokenStore que valida el
// capability bridge HTTP real. Sin DB ni SQLite ambos caen a la misma
// instancia en memoria del proceso.
import { describe, it, expect } from "vitest";
import {
  createProductionAdapterRegistry,
  runPluginInProduction,
} from "../../packages/plugin-sandbox/src/runtime/production-plugin-runner";
import { AdapterRegistry } from "../../packages/plugin-sandbox/src/adapters/adapter-registry";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { __resetPluginStorageStoreForTests } from "../../packages/plugin-sandbox/src/registry/plugin-storage";
import { onRequestPost as bridgeOnRequestPost } from "../../functions/api/internal/capability-bridge.js";
import type {
  PluginManifest,
  SandboxAdapter,
  SandboxExecutionInput,
} from "../../packages/plugin-sandbox/src/types";

const env = {};

function bridgeCall(token: string, capability: string) {
  const request = new Request("https://sitio.test/api/internal/capability-bridge", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ capability, args: {} }),
  });
  return bridgeOnRequestPost({ request, env } as never);
}

const manifest: PluginManifest = {
  name: "test-plugin",
  version: "1.0.0",
  entry: "index.js",
  runtime: "javascript",
  requestedCapabilities: [
    { id: "media:read", reason: "razón de prueba unitaria" },
    { id: "network:fetch", allowedHosts: ["api.example.com"], reason: "razón de prueba unitaria" },
  ],
};

function createRecordingAdapter(captured: SandboxExecutionInput[]): SandboxAdapter {
  return {
    providerName: "fake-edge",
    supportsWasm: false,
    isAvailable: async () => true,
    execute: async (input) => {
      captured.push(input);
      return {
        success: true,
        output: "ok",
        deniedCapabilityAttempts: [],
        durationMs: 0,
        provider: "fake-edge",
      };
    },
  };
}

function registryWith(adapter: SandboxAdapter): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return registry;
}

async function permissionStoreWith(grants: Array<{ capabilityId: string; granted: boolean }>) {
  const store = new InMemoryPermissionStore();
  for (const g of grants) {
    await store.setGrant({
      subject: { type: "plugin", id: manifest.name, displayName: manifest.name },
      capabilityId: g.capabilityId,
      granted: g.granted,
    });
  }
  return store;
}

describe("createProductionAdapterRegistry", () => {
  it("sin credenciales edge no registra adaptadores de Cloudflare ni Deno", async () => {
    const registry = await createProductionAdapterRegistry({});
    const names = registry.listRegistered();
    expect(names).not.toContain("cloudflare-workers-for-platforms");
    expect(names).not.toContain("deno-deploy");
  });

  it("registra Cloudflare solo con sus 3 credenciales y primero en el orden", async () => {
    const registry = await createProductionAdapterRegistry({
      PORTALESS_CLOUDFLARE_ACCOUNT_ID: "acct",
      PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE: "ns",
      PORTALESS_CLOUDFLARE_API_TOKEN: "token",
    });
    expect(registry.listRegistered()[0]).toBe("cloudflare-workers-for-platforms");
  });

  it("sin dispatcherUrl el adaptador Cloudflare igual se registra (isAvailable no lo exige)", async () => {
    const registry = await createProductionAdapterRegistry({
      PORTALESS_CLOUDFLARE_ACCOUNT_ID: "acct",
      PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE: "ns",
      PORTALESS_CLOUDFLARE_API_TOKEN: "token",
    });
    const adapter = await registry.resolve();
    expect(adapter.providerName).toBe("cloudflare-workers-for-platforms");
  });

  it("con env de Cloudflare y Deno, el orden de preferencia es Cloudflare, Deno", async () => {
    const registry = await createProductionAdapterRegistry({
      PORTALESS_CLOUDFLARE_ACCOUNT_ID: "acct",
      PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE: "ns",
      PORTALESS_CLOUDFLARE_API_TOKEN: "token",
      PORTALESS_DENO_PROJECT_ID: "proj",
      PORTALESS_DENO_API_TOKEN: "deno-token",
    });
    const names = registry.listRegistered();
    expect(names[0]).toBe("cloudflare-workers-for-platforms");
    expect(names[1]).toBe("deno-deploy");
  });

  it("registra Deno solo con projectId + apiToken", async () => {
    const registry = await createProductionAdapterRegistry({
      PORTALESS_DENO_PROJECT_ID: "proj",
      PORTALESS_DENO_API_TOKEN: "deno-token",
    });
    expect(registry.listRegistered()[0]).toBe("deno-deploy");
  });
});

describe("runPluginInProduction", () => {
  it("aplica granted = concedido ∩ pedido: una capacidad concedida de más nunca llega al adaptador", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([
      { capabilityId: "media:read", granted: true },
      { capabilityId: "site:admin", granted: true }, // concedida pero NO pedida en el manifiesto
    ]);

    const result = await runPluginInProduction(
      env,
      { manifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect([...captured[0].granted]).toEqual(["media:read"]);
  });

  it("provisa issueCapabilityToken real: el token emitido es aceptado por el bridge HTTP y respeta su snapshot", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([{ capabilityId: "media:read", granted: true }]);

    await runPluginInProduction(
      env,
      { manifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    const input = captured[0];
    expect(typeof input.issueCapabilityToken).toBe("function");
    const issued = await input.issueCapabilityToken!(manifest.name);

    // Mismo circuito que valida functions/api/internal/capability-bridge.js:
    expect((await bridgeCall(issued.token, "media:read")).status).toBe(501); // concedida, sin backend real
    expect((await bridgeCall(issued.token, "site:admin")).status).toBe(403); // fuera del snapshot
    expect((await bridgeCall("pless_nunca_emitido", "media:read")).status).toBe(401);
  });

  it("rechaza emitir tokens para un plugin distinto al que se ejecuta", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([{ capabilityId: "media:read", granted: true }]);

    await runPluginInProduction(
      env,
      { manifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    await expect(captured[0].issueCapabilityToken!("otro-plugin")).rejects.toThrow(/otro-plugin/);
  });

  it("sin capacidades concedidas el adaptador ve granted vacío", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([{ capabilityId: "media:read", granted: false }]);

    await runPluginInProduction(
      env,
      { manifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    expect([...captured[0].granted]).toEqual([]);
  });

  it("propaga bridgeUrl por-request al adaptador", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([]);

    await runPluginInProduction(
      env,
      {
        manifest,
        code: "//",
        payload: null,
        bridgeUrl: "https://sitio.test/api/internal/capability-bridge",
      },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    expect(captured[0].bridgeUrl).toBe("https://sitio.test/api/internal/capability-bridge");
  });

  it("si el caller no pasa bridgeUrl, cae a env.PORTALESS_CAPABILITY_BRIDGE_URL", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([]);

    await runPluginInProduction(
      { PORTALESS_CAPABILITY_BRIDGE_URL: "https://env.test/api/internal/capability-bridge" },
      { manifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    expect(captured[0].bridgeUrl).toBe("https://env.test/api/internal/capability-bridge");
  });

  it("§14.2: pasa al adaptador un hostBridge real de capacidades (storage con namespace y cuotas)", async () => {
    __resetPluginStorageStoreForTests();
    const captured: SandboxExecutionInput[] = [];
    const storageManifest: PluginManifest = {
      ...manifest,
      requestedCapabilities: [
        { id: "storage:write", reason: "guarda estado del plugin" },
        { id: "storage:read", reason: "lee estado del plugin" },
      ],
    };
    const permissionStore = await permissionStoreWith([
      { capabilityId: "storage:write", granted: true },
      { capabilityId: "storage:read", granted: true },
    ]);

    await runPluginInProduction(
      env,
      { manifest: storageManifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    const bridge = captured[0].hostBridge!;
    expect(typeof bridge.storageRead).toBe("function");
    expect(typeof bridge.storageWrite).toBe("function");

    await bridge.storageWrite!(storageManifest.name, { key: "estado", value: { n: 1 } });
    expect(await bridge.storageRead!(storageManifest.name, { key: "estado" })).toMatchObject({
      key: "estado",
      value: { n: 1 },
      found: true,
    });
    // Otro plugin no ve la clave (namespace por plugin).
    expect(await bridge.storageRead!("otro-plugin", { key: "estado" })).toMatchObject({ found: false });
  });

  it("manifiesto invalido falla sin llegar al adaptador", async () => {
    const captured: SandboxExecutionInput[] = [];
    const permissionStore = await permissionStoreWith([]);
    const badManifest = { ...manifest, name: "" } as PluginManifest;

    const result = await runPluginInProduction(
      env,
      { manifest: badManifest, code: "//", payload: null },
      { adapterRegistry: registryWith(createRecordingAdapter(captured)), permissionStore }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Manifiesto inválido/);
    expect(captured).toHaveLength(0);
  });
});
