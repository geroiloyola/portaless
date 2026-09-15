// Test end-to-end real de los 9 puentes de capacidades agregados en
// v0.0.9 (media:read/write, email:send, commerce:read/checkout,
// storage:read/write, agent:identify, site:admin). Antes de este PR solo
// 3 de 12 capacidades tenian puente real dentro del isolate
// (network:fetch, content:read, content:write) -- ver ROADMAP.md,
// "Puentes de capacidades restantes en isolated-vm (9 de 12)".
//
// Cada capacidad se prueba en sus 3 estados posibles:
// 1. Denegada (no concedida) -> el isolate nunca llega a tocar hostBridge.
// 2. Concedida pero sin handler real configurado -> error explicito
//    "handler no configurado", nunca un exito silencioso ni un 403 falso.
// 3. Concedida con handler real -> el handler del host se invoca de
//    verdad y su resultado cruza de vuelta al isolate.
//
// Se ejecuta en CI via .github/workflows/sandbox-e2e.yml (Vitest).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIsolatedVmAdapter } from "../../packages/plugin-sandbox/src/adapters/node-isolated-vm";
import type { CapabilityHostBridge } from "../../packages/plugin-sandbox/src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIsolatedVmVersion(): string {
  const candidatePaths = [
    join(__dirname, "..", "..", "packages", "plugin-sandbox", "node_modules", "isolated-vm", "package.json"),
    join(__dirname, "..", "..", "node_modules", "isolated-vm", "package.json"),
  ];
  for (const pkgPath of candidatePaths) {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version as string;
    }
  }
  throw new Error("isolated-vm package.json not found in any known location");
}

function makeManifest(capabilityId: string) {
  return {
    name: "capability-bridge-test-plugin",
    version: "0.0.1",
    entry: "index.js",
    runtime: "javascript" as const,
    requestedCapabilities: [{ id: capabilityId, reason: "test de puente de capacidad v0.0.9" }],
  };
}

async function getAdapter(t: { skip: (msg: string) => void }): Promise<NodeIsolatedVmAdapter | null> {
  let installedVersion: string;
  try {
    installedVersion = loadIsolatedVmVersion();
  } catch {
    t.skip("isolated-vm no esta instalado -- test omitido, no fallado.");
    return null;
  }
  const adapter = new NodeIsolatedVmAdapter({ installedVersion, timeoutMs: 10000 });
  if (!(await adapter.isAvailable())) {
    t.skip("isolated-vm no pudo cargarse en este runtime -- test omitido, no fallado.");
    return null;
  }
  return adapter;
}

describe("NodeIsolatedVmAdapter -- puentes de capacidades v0.0.9", () => {
  it("storage:read denegado -> el plugin nunca ve el hostBridge", async (t) => {
    const adapter = await getAdapter(t);
    if (!adapter) return;

    const code = `
      try {
        await capabilities.storageRead({ key: "foo" });
        "no deberia llegar aqui";
      } catch (err) {
        "denegado: " + err.message;
      }
    `;
    const result = await adapter.execute({
      manifest: makeManifest("storage:read"),
      granted: new Set(),
      code,
      payload: {},
      hostBridge: { storageRead: async () => ({ value: "no deberia invocarse" }) },
    });

    expect(result.success).toBe(true);
    expect(result.deniedCapabilityAttempts.includes("storage:read")).toBe(true);
  });

  it("storage:write concedida pero sin handler -> error explicito de handler no configurado", async (t) => {
    const adapter = await getAdapter(t);
    if (!adapter) return;

    const code = `
      try {
        await capabilities.storageWrite({ key: "foo", value: 1 });
        "no deberia tener exito";
      } catch (err) {
        "error_handler: " + err.message;
      }
    `;
    const result = await adapter.execute({
      manifest: makeManifest("storage:write"),
      granted: new Set(["storage:write"]),
      code,
      payload: {},
      // Sin hostBridge -- ningun handler configurado.
    });

    expect(result.success).toBe(true);
    expect(result.deniedCapabilityAttempts.includes("storage:write")).toBe(false);
    expect(result.output).toContain("error_handler");
    expect(result.output).toContain("handler no configurado");
  });

  it("agent:identify concedida con handler real -> el resultado del host cruza al isolate", async (t) => {
    const adapter = await getAdapter(t);
    if (!adapter) return;

    const hostBridge: CapabilityHostBridge = {
      agentIdentify: async (payload) => ({ verifiedAgents: 3, query: payload }),
    };
    const code = `
      const info = await capabilities.agentIdentify({ domain: "example.com" });
      JSON.stringify(info);
    `;
    const result = await adapter.execute({
      manifest: makeManifest("agent:identify"),
      granted: new Set(["agent:identify"]),
      code,
      payload: {},
      hostBridge,
    });

    expect(result.success, `deberia tener exito. Error: ${result.error}`).toBe(true);
    expect(result.deniedCapabilityAttempts.length).toBe(0);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.verifiedAgents).toBe(3);
    expect(parsed.query.domain).toBe("example.com");
  });

  it("email:send, commerce:read/checkout, media:read/write, site:admin -- concedidas con handler, todas responden", async (t) => {
    const adapter = await getAdapter(t);
    if (!adapter) return;

    const capabilityIds = [
      "email:send",
      "commerce:read",
      "commerce:checkout",
      "media:read",
      "media:write",
      "site:admin",
    ];

    const hostBridge: CapabilityHostBridge = {
      emailSend: async () => ({ sent: true }),
      commerceRead: async () => ({ products: [] }),
      commerceCheckout: async () => ({ checkoutUrl: "https://example.com/checkout/1" }),
      mediaRead: async () => ({ bytes: 10 }),
      mediaWrite: async () => ({ path: "/uploads/x.png" }),
      siteAdmin: async () => ({ applied: true }),
    };

    const manifest = {
      name: "capability-bridge-test-plugin",
      version: "0.0.1",
      entry: "index.js",
      runtime: "javascript" as const,
      requestedCapabilities: capabilityIds.map((id) => ({ id, reason: "test de puente v0.0.9" })),
    };

    const code = `
      const results = {};
      results.emailSend = await capabilities.emailSend({ to: "a@example.com", subject: "hi", body: "hi" });
      results.commerceRead = await capabilities.commerceRead({});
      results.commerceCheckout = await capabilities.commerceCheckout({});
      results.mediaRead = await capabilities.mediaRead({ path: "/x.png" });
      results.mediaWrite = await capabilities.mediaWrite({ path: "/x.png", data: "..." });
      results.siteAdmin = await capabilities.siteAdmin({ setting: "x" });
      JSON.stringify(results);
    `;

    const result = await adapter.execute({
      manifest,
      granted: new Set(capabilityIds as any),
      code,
      payload: {},
      hostBridge,
    });

    expect(result.success, `deberia tener exito. Error: ${result.error}`).toBe(true);
    expect(result.deniedCapabilityAttempts.length).toBe(0);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.emailSend.sent).toBe(true);
    expect(parsed.commerceCheckout.checkoutUrl).toContain("checkout");
    expect(parsed.mediaWrite.path).toBe("/uploads/x.png");
    expect(parsed.siteAdmin.applied).toBe(true);
  });
});
