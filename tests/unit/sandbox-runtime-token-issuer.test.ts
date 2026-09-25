// v0.0.9.27: SandboxRuntime como caller real de issueCapabilityToken.
import { describe, it, expect } from "vitest";
import { SandboxRuntime } from "../../packages/plugin-sandbox/src/runtime/sandbox-runtime";
import { InMemoryCapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store";
import type { SandboxAdapter, SandboxExecutionInput, PluginManifest, CapabilityId } from "../../packages/plugin-sandbox/src/types";

const manifest: PluginManifest = {
  name: "test-plugin",
  version: "0.0.1",
  entry: "index.js",
  runtime: "javascript",
  requestedCapabilities: [{ id: "content:read", reason: "test" }],
};

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
  };
  const runtime = new SandboxRuntime(
    { resolve: async () => adapter } as any,
    { getGrantedCapabilities: async () => new Set(granted) },
    tokenStore
  );
  return { runtime, input: () => captured! };
}

describe("SandboxRuntime + issueCapabilityToken", () => {
  it("con tokenStore, el adaptador recibe un emisor real y el token valida con el snapshot concedido", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const h = harness(["content:read"], store);
    await h.runtime.runPlugin(manifest, "", null);

    const issued = await h.input().issueCapabilityToken!("test-plugin");
    expect(issued.token).toMatch(/^pless_[0-9a-f]{64}$/);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());

    const v = await store.validate(issued.token);
    expect(v).toMatchObject({ valid: true, pluginName: "test-plugin", grantedCapabilities: ["content:read"] });
  });

  it("rechaza emitir un token para otro plugin", async () => {
    const h = harness(["content:read"], new InMemoryCapabilityTokenStore());
    await h.runtime.runPlugin(manifest, "", null);
    await expect(h.input().issueCapabilityToken!("otro-plugin")).rejects.toThrow(/otro-plugin/);
  });

  it("el snapshot es el concedido, no lo solicitado en el manifiesto", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const h = harness([], store);
    await h.runtime.runPlugin(manifest, "", null);
    const issued = await h.input().issueCapabilityToken!("test-plugin");
    expect((await store.validate(issued.token)).grantedCapabilities).toEqual([]);
  });

  it("sin tokenStore no se pasa emisor (compatibilidad con callers existentes)", async () => {
    const h = harness(["content:read"]);
    await h.runtime.runPlugin(manifest, "", null);
    expect(h.input().issueCapabilityToken).toBeUndefined();
  });
});
