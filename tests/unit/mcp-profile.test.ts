import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpConnectionProfile, isSecureMcpOrigin, MCP_PROFILE_TYP } from "../../packages/mcp-server/src/interop/mcp-profile";
import { MCP_TOOL_NAMES, SERVER_NAME } from "../../packages/mcp-server/src/metadata";
import { createPortalessMcpServer } from "../../packages/mcp-server/src/server";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";
import { onRequestGet } from "../../functions/.well-known/portaless-mcp.json.js";

describe("MCP interoperability profile", () => {
  it("publishes an HTTPS endpoint, bearer contract and the real tool inventory", () => {
    const profile = buildMcpConnectionProfile({ origin: "https://site.example" });
    expect(profile).toMatchObject({
      typ: MCP_PROFILE_TYP,
      version: "1.0",
      server: { name: SERVER_NAME, protocol: "mcp" },
      endpoint: { path: "/mcp", url: "https://site.example/mcp", transport: "streamable-http", stateless: true },
      authentication: {
        scheme: "bearer",
        header: "Authorization",
        format: "Bearer <token>",
        perInvocation: true,
      },
      transportSecurity: { publicHttpsRequired: true, secure: true },
    });
    expect(profile.toolCount).toBe(19);
    expect(profile.tools).toEqual([...MCP_TOOL_NAMES]);
    expect(JSON.stringify(profile)).not.toMatch(/pless_mcp_|Bearer ey/);
    expect(JSON.stringify(profile)).not.toMatch(/"apiKey"/);
  });

  it("allows loopback HTTP for local development but flags public HTTP", () => {
    expect(isSecureMcpOrigin("http://127.0.0.1:8788")).toBe(true);
    expect(isSecureMcpOrigin("http://localhost:8788")).toBe(true);
    expect(isSecureMcpOrigin("http://site.example")).toBe(false);
    expect(buildMcpConnectionProfile({ origin: "http://127.0.0.1:8788" }).warnings).toEqual([]);
    const publicHttp = buildMcpConnectionProfile({ origin: "http://site.example" });
    expect(publicHttp.transportSecurity.secure).toBe(false);
    expect(publicHttp.warnings).toContain("public_mcp_requires_https_or_supported_tunnel");
  });

  it("serves the profile as public well-known JSON without credentials", async () => {
    const response = await onRequestGet({
      request: new Request("https://site.example/.well-known/portaless-mcp.json"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.endpoint.url).toBe("https://site.example/mcp");
    expect(body.tools).toHaveLength(19);
    expect(JSON.stringify(body)).not.toContain("Bearer ey");
  });

  it("matches the tools the real McpServer registers", async () => {
    const server = createPortalessMcpServer({
      pageStore: { save: async (layout: unknown) => layout, load: async () => null } as never,
      permissionStore: new InMemoryPermissionStore(),
      pluginRegistry: { list: async () => [] } as never,
      auditLog: new InMemoryAuditLogStore(),
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent: createEnvAgentIdentityResolver({ MCP_AGENT_KEY: "profile-test" } as NodeJS.ProcessEnv),
    });
    const client = new Client({ name: "profile-test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });
});
