// functions/admin/api/mcp-agents.js (nueva superficie: emision de tokens
// de agentes MCP). Mismo patron que admin-agents-status-endpoints.test.ts:
// el factory del token store se mockea para compartir UN store InMemory
// entre requests (los reales se instancian de nuevo por request y el
// estado se perderia). Cubre: 401 sin sesion, 403 para rol viewer, emision
// de token plaintext UNA sola vez (POST), que GET nunca filtra plaintexts
// ni hashes, y revocacion via PATCH (con revoked=false cuando no habia
// token activo).

import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/mcp-server/src/permissions/agent-token-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/mcp-server/src/permissions/agent-token-store")>();
  const store = new original.InMemoryMcpAgentTokenStore();
  return { ...original, createMcpAgentTokenStore: async () => store, __sharedStore: store };
});

import * as mcpAgents from "../../functions/admin/api/mcp-agents";
import * as tokenStoreModule from "../../packages/mcp-server/src/permissions/agent-token-store";

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown } = {}) {
  const request = new Request("http://x.test/admin/api/mcp-agents", {
    method: "POST",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    env: {},
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

describe("GET /admin/api/mcp-agents", () => {
  it("401 sin sesion", async () => {
    const res = await mcpAgents.onRequestGet(ctx({ user: null }));
    expect(res.status).toBe(401);
  });

  it("lista registros sin plaintexts ni hashes y con la meta del token recien emitido via POST", async () => {
    const issue = await mcpAgents.onRequestPost(
      ctx({ user: { username: "admin", role: "admin" }, body: { agentKeyId: "ed25519:agente-x", displayName: "Agente X" } })
    );
    expect(issue.status).toBe(200);
    const issued = await issue.json();
    expect(issued.ok).toBe(true);
    expect(issued.token).toMatch(/^pless_mcp_/);
    expect(issued.record).toMatchObject({ agentKeyId: "ed25519:agente-x", displayName: "Agente X", revoked: false });

    const res = await mcpAgents.onRequestGet(ctx({ user: { username: "viewer", role: "viewer" } }));
    const body = await res.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).not.toHaveProperty("token");
    expect(body.tokens[0]).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(body)).not.toContain(issued.token);
  });
});

describe("POST /admin/api/mcp-agents", () => {
  it("401 sin sesion y 403 para rol viewer (escritura solo admin)", async () => {
    const unauth = await mcpAgents.onRequestPost(ctx({ user: null, body: { agentKeyId: "a", displayName: "A" } }));
    expect(unauth.status).toBe(401);

    const forbidden = await mcpAgents.onRequestPost(
      ctx({ user: { username: "v", role: "viewer" }, body: { agentKeyId: "a", displayName: "A" } })
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: "forbidden" });
  });

  it("400 si falta agentKeyId o displayName, o el body no es JSON", async () => {
    const admin = { username: "admin", role: "admin" };
    expect((await mcpAgents.onRequestPost(ctx({ user: admin, body: { agentKeyId: "solo" } }))).status).toBe(400);
    expect((await mcpAgents.onRequestPost(ctx({ user: admin, body: { displayName: "solo" } }))).status).toBe(400);

    const bad = ctx({ user: admin });
    (bad.request as Request) = new Request("http://x.test/admin/api/mcp-agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{esto-no-es-json",
    });
    expect((await mcpAgents.onRequestPost(bad)).status).toBe(400);
  });

  it("reemitir rota: el token previo deja de verificar", async () => {
    const admin = { username: "admin", role: "admin" };
    const first = await (await mcpAgents.onRequestPost(ctx({ user: admin, body: { agentKeyId: "ed25519:rot", displayName: "Rot" } }))).json();
    const second = await (await mcpAgents.onRequestPost(ctx({ user: admin, body: { agentKeyId: "ed25519:rot", displayName: "Rot" } }))).json();

    expect(second.token).not.toBe(first.token);
    const store = (tokenStoreModule as { __sharedStore: { verify(t: string): Promise<unknown> } }).__sharedStore;
    expect(await store.verify(first.token)).toBeNull();
    expect(await store.verify(second.token)).toMatchObject({ agentKeyId: "ed25519:rot" });
  });
});

describe("PATCH /admin/api/mcp-agents", () => {
  it("401/403 igual que POST, y 400 sin agentKeyId", async () => {
    expect((await mcpAgents.onRequestPatch(ctx({ user: null, body: { agentKeyId: "x" } }))).status).toBe(401);
    expect(
      (await mcpAgents.onRequestPatch(ctx({ user: { username: "v", role: "viewer" }, body: { agentKeyId: "x" } }))).status
    ).toBe(403);
    expect((await mcpAgents.onRequestPatch(ctx({ user: { username: "a", role: "admin" }, body: {} }))).status).toBe(400);
  });

  it("revoca el token activo del agente (revoked=true) y luego responde revoked=false", async () => {
    const admin = { username: "admin", role: "admin" };
    const issued = await (await mcpAgents.onRequestPost(ctx({ user: admin, body: { agentKeyId: "ed25519:revoke-me", displayName: "R" } }))).json();

    const first = await (await mcpAgents.onRequestPatch(ctx({ user: admin, body: { agentKeyId: "ed25519:revoke-me" } }))).json();
    expect(first).toMatchObject({ ok: true, revoked: true });

    const second = await (await mcpAgents.onRequestPatch(ctx({ user: admin, body: { agentKeyId: "ed25519:revoke-me" } }))).json();
    expect(second).toMatchObject({ ok: true, revoked: false });

    const store = (tokenStoreModule as { __sharedStore: { verify(t: string): Promise<unknown> } }).__sharedStore;
    expect(await store.verify(issued.token)).toBeNull();
  });
});
