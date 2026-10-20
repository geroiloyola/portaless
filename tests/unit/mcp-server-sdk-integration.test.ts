// packages/mcp-server/src/server.ts (ahora testeable con el SDK real
// instalado): smoke de integracion end-to-end via InMemoryTransport --
// valida que createPortalessMcpServer registra las tools reales sobre
// McpServer del SDK y que una invocacion via Client ejecuta el handler
// con su resolveAgent (aqui el de env/Opcion A, porque InMemoryTransport
// no aporta authInfo -- el camino por invocacion con token esta cubierto
// en mcp-tools-per-invocation.test.ts invocando los handlers directo).

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPortalessMcpServer } from "../../packages/mcp-server/src/server";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";
import type { AuditLogEntry } from "../../packages/mcp-server/src/audit/types";

const ENV_AGENT = { key: "ed25519:agente-env", displayName: "Agente Env" };

async function connectedClient() {
  const permissionStore = new InMemoryPermissionStore();
  await permissionStore.setGrant({
    subject: { type: "agent", id: ENV_AGENT.key, displayName: ENV_AGENT.displayName },
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

  const auditEntries: AuditLogEntry[] = [];
  const auditLog = new InMemoryAuditLogStore();
  const originalAppend = auditLog.append.bind(auditLog);
  auditLog.append = async (entry) => {
    auditEntries.push(entry);
    return originalAppend(entry);
  };

  const server = createPortalessMcpServer({
    pageStore: pageStore as never,
    permissionStore,
    pluginRegistry: { list: async () => [] } as never,
    auditLog,
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent: createEnvAgentIdentityResolver({
      MCP_AGENT_KEY: ENV_AGENT.key,
      MCP_AGENT_DISPLAY_NAME: ENV_AGENT.displayName,
    } as NodeJS.ProcessEnv),
  });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, saved, auditEntries };
}

describe("createPortalessMcpServer -- integracion con el SDK real (InMemoryTransport)", () => {
  it("registra las tools del servidor", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "apply_theme",
      "approve_page_revision",
      "create_page",
      "delete_block",
      "get_page_context",
      "get_site_context",
      "grant_capability",
      "insert_block",
      "list_installed_plugins",
      "list_page_components",
      "list_page_proposals",
      "list_themes",
      "propose_page_revision",
      "query_usage_log",
      "read_documentation",
      "read_private_page_context",
      "revoke_permission",
      "update_block",
      "update_page",
    ]);
  });

  it("list_page_components responde los ElementType y su metadata sin identidad ni auditoria", async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: "list_page_components", arguments: {} });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.elementTypes).toContain("Hero");
    expect(payload.elementTypes).toContain("StoreBlock");
    // Catalogo completo: metadata por tipo (lo que un agente usa para proponer
    // props validas). Todos los tipos del palette deben venir con su def.
    expect(payload.elements).toHaveLength(payload.elementTypes.length);
    const hero = payload.elements.find((e: { type: string }) => e.type === "Hero");
    expect(hero).toMatchObject({ type: "Hero" });
    expect(typeof hero.displayName).toBe("string");
    expect(typeof hero.icon).toBe("string");
    expect(Array.isArray(hero.editableProps)).toBe(true);
    // renderHTML es funcion de render del sitio: no debe filtrarse al agente.
    expect(hero.renderHTML).toBeUndefined();
  });

  it("create_page via Client ejecuta el handler con la identidad del resolver (env) y audita", async () => {
    const { client, saved, auditEntries } = await connectedClient();

    const result = await client.callTool({
      name: "create_page",
      arguments: { slug: "equipo", title: "Equipo", root: [] },
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload).toMatchObject({ saved: true, slug: "equipo", status: "draft" });
    expect(saved).toHaveLength(1);

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      agentKeyId: ENV_AGENT.key,
      toolName: "create_page",
      capabilityId: "content:write",
      outcome: "success",
    });
  });

  it("query_usage_log via Client audita con la identidad resuelta", async () => {
    const { client, auditEntries } = await connectedClient();
    const result = await client.callTool({ name: "query_usage_log", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(auditEntries[0]).toMatchObject({ agentKeyId: ENV_AGENT.key, toolName: "query_usage_log", outcome: "success" });
  });
});
