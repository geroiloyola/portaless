// v0.0.9.27: SandboxRuntime como caller real de issueCapabilityToken.
//
// validateManifest se mockea: este archivo prueba la emision de tokens, no el
// schema del manifiesto (que tiene sus propios tests). Antes, un manifiesto de
// prueba que no cumplia el schema hacia que runPlugin devolviera
// { success: false } sin invocar al adaptador, y los tests fallaban con un
// "Cannot read properties of undefined" que ocultaba la causa real.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/plugin-sandbox/src/manifest/manifest-schema", () => ({
  validateManifest: () => ({ valid: true, errors: [] }),
}));

import { SandboxRuntime } from "../../packages/plugin-sandbox/src/runtime/sandbox-runtime";
import { InMemoryCapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store";
import type { SandboxAdapter, SandboxExecutionInput, PluginManifest, CapabilityId } from "../../packages/plugin-sandbox/src/types";

const manifest = {
  name: "test-plugin",
  version: "0.0.1",
  entry: "index.js",
  runtime: "javascript",
  requestedCapabilities: [{ id: "content:read", reason: "test" }],
} as unknown as PluginManifest;

function harness(granted: CapabilityId[], tokenStore?: InMemoryCapabilityTokenStore) {
  let captured: SandboxExecutionInput | undefined;
  const adapter: SandboxAdapter = {
    providerName: "fake-edge",
    supportsWasm: false,
    isAvailable: async () => true,
    execute: async (input) => {
      captured = input;
      return { success: true, deniedCapabilityAttempts: [], durationMs: 0, provider: "fake-edge" };
    },
  } as SandboxAdapter;
  const runtime = new SandboxRuntime(
    { resolve: async () => adapter } as any,
    { getGrantedCapabilities: async () => new Set(granted) } as any,
    tokenStore
  );

  async function run(): Promise<SandboxExecutionInput> {
    const result = await runtime.runPlugin(manifest, "", null);
    if (!captured) {
      throw new Error(`El adaptador no fue invocado. runPlugin devolvio: ${JSON.stringify(result)}`);
    }
    return captured;
  }

  return { run };
}

describe("SandboxRuntime + issueCapabilityToken", () => {
  it("con tokenStore, el adaptador recibe un emisor real y el token valida con el snapshot concedido", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const input = await harness(["content:read"] as CapabilityId[], store).run();

    const issued = await input.issueCapabilityToken!("test-plugin");
    expect(issued.token).toMatch(/^pless_[0-9a-f]{64}$/);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());

    const v = await store.validate(issued.token);
    expect(v).toMatchObject({ valid: true, pluginName: "test-plugin", grantedCapabilities: ["content:read"] });
  });

  it("rechaza emitir un token para otro plugin", async () => {
    const input = await harness(["content:read"] as CapabilityId[], new InMemoryCapabilityTokenStore()).run();
    await expect(input.issueCapabilityToken!("otro-plugin")).rejects.toThrow(/otro-plugin/);
  });

  it("el snapshot es el concedido, no lo solicitado en el manifiesto", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const input = await harness([], store).run();
    const issued = await input.issueCapabilityToken!("test-plugin");
    expect((await store.validate(issued.token)).grantedCapabilities).toEqual([]);
  });

  it("sin tokenStore no se pasa emisor (compatibilidad con callers existentes)", async () => {
    const input = await harness(["content:read"] as CapabilityId[]).run();
    expect(input.issueCapabilityToken).toBeUndefined();
  });
});
