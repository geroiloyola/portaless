// Tests del puente real de content:read/content:write -- v0.0.9.4.
// Antes de este PR, ambas capacidades SOLO tenian el guard de denegacion
// (nunca la funcion positiva registrada), aunque estuvieran concedidas en
// el manifest del plugin.

import { describe, it, expect } from "vitest";
import { NodeIsolatedVmAdapter } from "../../packages/plugin-sandbox/src/adapters/node-isolated-vm";
import type { PluginManifest, SandboxExecutionInput } from "../../packages/plugin-sandbox/src/types";

function buildManifest(capabilityIds: string[]): PluginManifest {
  return {
    name: "content-bridge-test-plugin",
    version: "0.0.1",
    requestedCapabilities: capabilityIds.map((id) => ({ id: id as any })),
  } as PluginManifest;
}

function buildAdapter(): NodeIsolatedVmAdapter {
  return new NodeIsolatedVmAdapter({ installedVersion: "7.0.1", poolMaxIsolates: 0 });
}

describe("content:read - puente real", () => {
  it("sin la capacidad concedida, el plugin recibe el rechazo esperado", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest([]),
      granted: new Set([]),
      code: "await capabilities.readContent({ slug: 'inicio' });",
      payload: null,
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(false);
    expect(result.deniedCapabilityAttempts).toContain("content:read");
  });

  it("con la capacidad concedida pero sin hostBridge.contentRead configurado, devuelve NOT_CONFIGURED", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest(["content:read"]),
      granted: new Set(["content:read"]),
      code: "await capabilities.readContent({ slug: 'inicio' });",
      payload: null,
      hostBridge: {},
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("content:read");
    expect(result.error).toContain("no configurado");
  });

  it("con hostBridge.contentRead configurado, el plugin recibe el valor real ida y vuelta", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest(["content:read"]),
      granted: new Set(["content:read"]),
      code: `
        const page = await capabilities.readContent({ slug: 'inicio' });
        page.title
      `,
      payload: null,
      hostBridge: {
        contentRead: async (args: { slug: string }) => ({
          slug: args.slug,
          title: "Bienvenido a Portaless",
          blocks: [{ type: "Hero", props: {} }],
        }),
      },
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(true);
    expect(result.output).toBe("Bienvenido a Portaless");
  });
});

describe("content:write - puente real", () => {
  it("sin la capacidad concedida, el plugin recibe el rechazo esperado", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest([]),
      granted: new Set([]),
      code: "await capabilities.writeContent({ slug: 'inicio', title: 'x' });",
      payload: null,
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(false);
    expect(result.deniedCapabilityAttempts).toContain("content:write");
  });

  it("con la capacidad concedida pero sin hostBridge.contentWrite configurado, devuelve NOT_CONFIGURED", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest(["content:write"]),
      granted: new Set(["content:write"]),
      code: "await capabilities.writeContent({ slug: 'inicio', title: 'x' });",
      payload: null,
      hostBridge: {},
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("content:write");
    expect(result.error).toContain("no configurado");
  });

  it("con hostBridge.contentWrite configurado, el plugin puede escribir y recibir confirmacion", async () => {
    const adapter = buildAdapter();
    const writeCalls: unknown[] = [];
    const input: SandboxExecutionInput = {
      manifest: buildManifest(["content:write"]),
      granted: new Set(["content:write"]),
      code: `
        const result = await capabilities.writeContent({ slug: 'inicio', title: 'Nuevo titulo' });
        result.success
      `,
      payload: null,
      hostBridge: {
        contentWrite: async (args: unknown) => {
          writeCalls.push(args);
          return { success: true };
        },
      },
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(true);
    expect(result.output).toBe(true);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toEqual({ slug: "inicio", title: "Nuevo titulo" });
  });

  it("ambas capacidades concedidas simultaneamente no interfieren entre si", async () => {
    const adapter = buildAdapter();
    const input: SandboxExecutionInput = {
      manifest: buildManifest(["content:read", "content:write"]),
      granted: new Set(["content:read", "content:write"]),
      code: `
        const page = await capabilities.readContent({ slug: 'inicio' });
        const writeResult = await capabilities.writeContent({ slug: 'inicio', title: page.title + ' editado' });
        writeResult.newTitle
      `,
      payload: null,
      hostBridge: {
        contentRead: async () => ({ title: "Original" }),
        contentWrite: async (args: { title: string }) => ({ newTitle: args.title }),
      },
    } as any;

    const result = await adapter.execute(input);
    expect(result.success).toBe(true);
    expect(result.output).toBe("Original editado");
  });
});
