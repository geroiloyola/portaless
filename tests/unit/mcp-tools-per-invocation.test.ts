// packages/mcp-server/src/tools/* (los 7): identidad POR INVOCACION via
// deps.resolveAgent (Opcion B). Un fake McpServer captura los handlers
// registrados y se los invoca directo con (args, extra), simulando el
// "extra" que el SDK de MCP pasa por request (con authInfo.token del
// bearer HTTP). El nucleo del item: dos tokens distintos en dos
// invocaciones son dos identidades con permisos y auditoria separados.

import { describe, it, expect } from "vitest";
import {
  createBearerTokenAgentIdentityResolver,
  AgentIdentityError,
} from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryMcpAgentTokenStore } from "../../packages/mcp-server/src/permissions/agent-token-store";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { CapabilityDeniedError } from "../../packages/mcp-server/src/permissions/require-capability";
import { registerGrantCapabilityTool } from "../../packages/mcp-server/src/tools/grant-capability";
import { registerCreatePageTool } from "../../packages/mcp-server/src/tools/create-page";
import { registerQueryUsageLogTool } from "../../packages/mcp-server/src/tools/query-usage-log";
import type { AuditLogEntry, AuditLogStore } from "../../packages/mcp-server/src/audit/types";

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;

function fakeMcpServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
      return {};
    },
  };
  return { server: server as never, tools };
}

function fakeAuditLog() {
  const entries: AuditLogEntry[] = [];
  const store: AuditLogStore = {
    append: async (entry) => {
      entries.push(entry);
    },
    list: async () => entries,
  };
  return { store, entries };
}

const AGENT_A = { agentKeyId: "ed25519:agente-a", displayName: "Agente A" };
const AGENT_B = { agentKeyId: "ed25519:agente-b", displayName: "Agente B" };

async function seededTokens() {
  const store = new InMemoryMcpAgentTokenStore();
  const a = await store.issue(AGENT_A);
  const b = await store.issue(AGENT_B);
  return { tokenA: a.token, tokenB: b.token, resolveAgent: createBearerTokenAgentIdentityResolver(store) };
}

const extraA = (tokenA: string) => ({ authInfo: { token: tokenA } });

describe("grant_capability -- identidad por invocacion", () => {
  async function setup() {
    const { tokenA, tokenB, resolveAgent } = await seededTokens();
    const permissionStore = new InMemoryPermissionStore();
    // Solo el agente-A tiene site:admin.
    await permissionStore.setGrant({
      subject: { type: "agent", id: AGENT_A.agentKeyId, displayName: AGENT_A.displayName },
      capabilityId: "site:admin",
      granted: true,
      grantedBy: "test-seed",
    });
    const { store: auditLog, entries } = fakeAuditLog();
    const { server, tools } = fakeMcpServer();
    registerGrantCapabilityTool(server, {
      permissionStore,
      auditLog,
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent,
    });
    return { handler: tools.get("grant_capability")!, tokenA, tokenB, entries, permissionStore };
  }

  it("token-A (con site:admin) concede y audita como agente-A; token-B (sin permiso) es denegado como agente-B", async () => {
    const { handler, tokenA, tokenB, entries } = await setup();

    const result = (await handler(
      { subjectType: "plugin", subjectId: "plugin-x", subjectDisplayName: "Plugin X", capabilityId: "content:read" },
      extraA(tokenA)
    )) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toMatchObject({ granted: true, subjectId: "plugin-x" });

    // Mismo handler, OTRO token: la identidad resuelta es B (sin site:admin).
    // La denegacion se hace visible via CapabilityDeniedError (requireCapability
    // lanza ANTES de recordToolInvocation, comportamiento existente -- la
    // denegacion no entra al audit log, lo que si queda es el error para el cliente).
    const denial = await handler(
      { subjectType: "plugin", subjectId: "plugin-y", subjectDisplayName: "Plugin Y", capabilityId: "content:read" },
      { authInfo: { token: tokenB } }
    ).catch((e) => e);
    expect(denial).toBeInstanceOf(CapabilityDeniedError);
    expect(denial.message).toContain("Agente B");
    expect(denial.message).toContain(AGENT_B.agentKeyId);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentKeyId: AGENT_A.agentKeyId, toolName: "grant_capability", outcome: "success" });
  });

  it("grantedBy registrado en el PermissionStore es el agente RESUELTO en esa invocacion", async () => {
    const { handler, tokenA, permissionStore } = await setup();

    await handler(
      { subjectType: "plugin", subjectId: "plugin-z", subjectDisplayName: "Plugin Z", capabilityId: "content:read" },
      extraA(tokenA)
    );

    const grants = await permissionStore.getGrantsFor({
      type: "plugin",
      id: "plugin-z",
      displayName: "Plugin Z",
    });
    expect(grants).toHaveLength(1);
    expect(grants[0].grantedBy).toBe(`mcp-agent:${AGENT_A.agentKeyId}`);
  });

  it("invocacion SIN token lanza AgentIdentityError missing_token y NO esconde el fallo", async () => {
    const { handler } = await setup();
    await expect(handler({ subjectType: "plugin", subjectId: "x", subjectDisplayName: "X", capabilityId: "c" })).rejects.toMatchObject({
      name: "AgentIdentityError",
      reason: "missing_token",
    });
    await expect(handler({ subjectType: "plugin", subjectId: "x", subjectDisplayName: "X", capabilityId: "c" }, { authInfo: {} })).rejects.toBeInstanceOf(
      AgentIdentityError
    );
  });
});

describe("create_page -- identidad por invocacion", () => {
  async function setup() {
    const { tokenA, tokenB, resolveAgent } = await seededTokens();
    const permissionStore = new InMemoryPermissionStore();
    await permissionStore.setGrant({
      subject: { type: "agent", id: AGENT_A.agentKeyId, displayName: AGENT_A.displayName },
      capabilityId: "content:write",
      granted: true,
      grantedBy: "test-seed",
    });
    const saved: Array<Record<string, unknown>> = [];
    const pageStore = {
      save: async (layout: Record<string, unknown>) => {
        saved.push(layout);
        return layout;
      },
      load: async () => null,
    };
    const { store: auditLog, entries } = fakeAuditLog();
    const { server, tools } = fakeMcpServer();
    registerCreatePageTool(server, {
      pageStore: pageStore as never,
      permissionStore,
      auditLog,
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent,
    });
    return { handler: tools.get("create_page")!, tokenA, tokenB, saved, entries };
  }

  const pageArgs = {
    slug: "nosotros",
    title: "Nosotros",
    root: [],
    draftMode: true,
  };

  it("agente-A crea pagina (borrador) y audita como A; agente-B sin content:write es denegado como B", async () => {
    const { handler, tokenA, tokenB, saved, entries } = await setup();

    const result = (await handler(pageArgs, extraA(tokenA))) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toMatchObject({ saved: true, slug: "nosotros-draft" });
    expect(saved).toHaveLength(1);

    const denial = await handler(pageArgs, { authInfo: { token: tokenB } }).catch((e) => e);
    expect(denial).toBeInstanceOf(CapabilityDeniedError);
    expect(denial.message).toContain("Agente B");
    expect(denial.message).toContain(AGENT_B.agentKeyId);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentKeyId: AGENT_A.agentKeyId, outcome: "success" });
  });
});

describe("query_usage_log -- identidad por invocacion en tool de lectura", () => {
  it("cada invocacion audita con la identidad resuelta de ESA llamada", async () => {
    const { tokenA, tokenB, resolveAgent } = await seededTokens();
    const { store: auditLog, entries } = fakeAuditLog();
    const { server, tools } = fakeMcpServer();
    registerQueryUsageLogTool(server, {
      usageLedger: new InMemoryUsageLedgerStore(),
      auditLog,
      resolveAgent,
    });
    const handler = tools.get("query_usage_log")!;

    await handler({}, extraA(tokenA));
    await handler({}, { authInfo: { token: tokenB } });

    expect(entries).toHaveLength(2);
    expect(entries[0].agentKeyId).toBe(AGENT_A.agentKeyId);
    expect(entries[1].agentKeyId).toBe(AGENT_B.agentKeyId);
    expect(entries.every((e) => e.toolName === "query_usage_log" && e.outcome === "success")).toBe(true);
  });
});
