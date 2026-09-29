// El runtime construido por createSandboxRuntime() usa el MISMO token
// store que valida el capability bridge: un token emitido ahi es aceptado
// por el endpoint real. Sin DB ni SQLite ambos caen a la misma instancia
// en memoria del proceso.
import { describe, it, expect } from "vitest";
import { createSandboxRuntime } from "../../packages/plugin-sandbox/src/runtime/sandbox-runtime-factory";
import { createCapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store-factory";
import { onRequestPost } from "../../functions/api/internal/capability-bridge.js";

const env = {};

function bridgeCall(token: string, capability: string) {
  const request = new Request("https://sitio.test/api/internal/capability-bridge", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ capability, args: {} }),
  });
  return onRequestPost({ request, env } as never);
}

describe("createSandboxRuntime", () => {
  it("inyecta el mismo CapabilityTokenStore que usa el bridge", async () => {
    const runtime = await createSandboxRuntime(env, {} as never, { getGrantedCapabilities: async () => [] as never });
    const shared = await createCapabilityTokenStore(env);
    expect((runtime as unknown as { tokenStore: unknown }).tokenStore).toBe(shared);
  });

  it("un token emitido por ese store es aceptado por el bridge y respeta su snapshot", async () => {
    const store = await createCapabilityTokenStore(env);
    const { token } = await store.issue("pless_factorytest01", "hello-plugin", ["media:read"] as never);

    expect((await bridgeCall(token, "media:read")).status).toBe(501);
    expect((await bridgeCall(token, "content:write")).status).toBe(403);
    expect((await bridgeCall("pless_nunca_emitido", "media:read")).status).toBe(401);
  });
});
