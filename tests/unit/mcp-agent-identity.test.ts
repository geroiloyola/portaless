// packages/mcp-server/src/permissions/agent-identity.ts (nuevo): el seam
// de identidad POR INVOCACION del mcp-server (Opcion B). Cubre el
// resolver de env (Opcion A: identidad fija por proceso, fail-fast sin
// MCP_AGENT_KEY), el resolver de bearer token (verifica CADA
// invocacion contra McpAgentTokenStore -- dos tokens = dos identidades),
// y extractBearerToken (parsing del header Authorization).

import { describe, it, expect } from "vitest";
import {
  createEnvAgentIdentityResolver,
  createBearerTokenAgentIdentityResolver,
  extractBearerToken,
  AgentIdentityError,
} from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryMcpAgentTokenStore } from "../../packages/mcp-server/src/permissions/agent-token-store";

describe("createEnvAgentIdentityResolver (Opcion A)", () => {
  it("devuelve siempre la misma identidad construida desde env, ignorando el ctx", async () => {
    const resolver = createEnvAgentIdentityResolver({
      MCP_AGENT_KEY: "ed25519:proceso-unico",
      MCP_AGENT_DISPLAY_NAME: "Agente fijo",
    } as NodeJS.ProcessEnv);

    const first = await resolver();
    const second = await resolver({ authInfo: { token: "algo-que-no-debe-usarse" } });

    expect(first).toEqual({ key: "ed25519:proceso-unico", displayName: "Agente fijo" });
    expect(second).toEqual(first);
  });

  it("sin MCP_AGENT_DISPLAY_NAME usa la key como displayName", async () => {
    const resolver = createEnvAgentIdentityResolver({ MCP_AGENT_KEY: "k" } as NodeJS.ProcessEnv);
    expect(await resolver()).toEqual({ key: "k", displayName: "k" });
  });

  it("sin MCP_AGENT_KEY lanza al construir (fail-fast, no en la primera tool)", () => {
    expect(() => createEnvAgentIdentityResolver({} as NodeJS.ProcessEnv)).toThrow(/MCP_AGENT_KEY/);
  });
});

describe("createBearerTokenAgentIdentityResolver (Opcion B)", () => {
  async function seededStore() {
    const store = new InMemoryMcpAgentTokenStore();
    const a = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "Agente A" });
    const b = await store.issue({ agentKeyId: "ed25519:agente-b", displayName: "Agente B" });
    return { store, tokenA: a.token, tokenB: b.token };
  }

  it("resuelve identidades DISTINTAS por invocacion segun el token de cada llamada", async () => {
    const { store, tokenA, tokenB } = await seededStore();
    const resolver = createBearerTokenAgentIdentityResolver(store);

    const identityA = await resolver({ authInfo: { token: tokenA } });
    const identityB = await resolver({ authInfo: { token: tokenB } });
    const identityA2 = await resolver({ authInfo: { token: tokenA } });

    expect(identityA).toEqual({ key: "ed25519:agente-a", displayName: "Agente A" });
    expect(identityB).toEqual({ key: "ed25519:agente-b", displayName: "Agente B" });
    expect(identityA2).toEqual(identityA);
  });

  it("token revocado deja de resolver: la siguiente invocacion lanza invalid_token", async () => {
    const { store, tokenA } = await seededStore();
    const resolver = createBearerTokenAgentIdentityResolver(store);

    await store.revoke("ed25519:agente-a");

    await expect(resolver({ authInfo: { token: tokenA } })).rejects.toMatchObject({
      name: "AgentIdentityError",
      reason: "invalid_token",
    });
  });

  it("token desconocido lanza AgentIdentityError invalid_token", async () => {
    const { store } = await seededStore();
    const resolver = createBearerTokenAgentIdentityResolver(store);

    const err = await resolver({ authInfo: { token: "pless_mcp_falso" } }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentIdentityError);
    expect(err.reason).toBe("invalid_token");
    expect(err.message).toContain("revocado");
  });

  it("sin token en el ctx (o sin authInfo) lanza missing_token", async () => {
    const { store } = await seededStore();
    const resolver = createBearerTokenAgentIdentityResolver(store);

    await expect(resolver()).rejects.toMatchObject({ reason: "missing_token" });
    await expect(resolver({})).rejects.toMatchObject({ reason: "missing_token" });
    await expect(resolver({ authInfo: null })).rejects.toMatchObject({ reason: "missing_token" });
    await expect(resolver({ authInfo: {} })).rejects.toMatchObject({ reason: "missing_token" });
  });
});

describe("extractBearerToken", () => {
  it("extrae el token crudo del header Authorization: Bearer", () => {
    expect(extractBearerToken("Bearer pless_mcp_abc")).toBe("pless_mcp_abc");
    expect(extractBearerToken("bearer abc")).toBe("abc"); // case-insensitive en el esquema
    expect(extractBearerToken("BEARER   abc  ")).toBe("abc");
  });

  it("devuelve null en headers ausentes o malformados", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("pless_mcp_abc")).toBeNull(); // sin esquema
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull(); // sin token
    expect(extractBearerToken("Bearer a b")).toBeNull(); // dos tokens
  });
});
