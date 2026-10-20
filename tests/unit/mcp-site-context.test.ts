import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";
import { registerSiteContextTools } from "../../packages/mcp-server/src/tools/site-context";
import { BUILTIN_THEMES } from "../../packages/atomic-elements/src/themes/theme-pack";

const agent = { key: "mcp-context-agent", displayName: "Context Agent" };
const tempDirs: string[] = [];
function dbPath() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-mcp-context-"));
  tempDirs.push(dir);
  return join(dir, "node.sqlite");
}

async function connected({ granted = true, privateGranted = false }: { granted?: boolean; privateGranted?: boolean } = {}) {
  const pageStore = await createPageStore({ PORTALESS_SQLITE_PATH: dbPath() });
  const permissionStore = new InMemoryPermissionStore();
  if (granted) await permissionStore.setGrant({
    subject: { type: "agent", id: agent.key, displayName: agent.displayName },
    capabilityId: "content:read", granted: true, grantedBy: "test",
  });
  if (privateGranted) await permissionStore.setGrant({
    subject: { type: "agent", id: agent.key, displayName: agent.displayName },
    capabilityId: "mcp:private-context:read", granted: true, grantedBy: "test",
  });
  await pageStore.save({ version: "0.1", slug: "public-page", title: "Public", status: "published", theme: "2pac-dark", root: [{ id: "heading", type: "Heading", props: { text: "Public content" } }] }, { expectedRevisionId: null });
  await pageStore.save({ version: "0.1", slug: "draft-page", title: "DRAFT_PRIVATE_MARKER", status: "draft", root: [] }, { expectedRevisionId: null });
  await pageStore.save({ version: "0.1", slug: "private-page", title: "PRIVATE_MARKER", status: "private", root: [] }, { expectedRevisionId: null });

  const server = new McpServer({ name: "context-test", version: "0.0.1" });
  registerSiteContextTools(server, {
    pageStore,
    permissionStore,
    auditLog: new InMemoryAuditLogStore(),
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent: createEnvAgentIdentityResolver({ MCP_AGENT_KEY: agent.key, MCP_AGENT_DISPLAY_NAME: agent.displayName } as NodeJS.ProcessEnv),
    themes: [...BUILTIN_THEMES],
    siteSkin: { get: async () => ({ siteId: "default", skin: "base", tokens: { accent: "#abc123" }, updatedAt: "2026-10-01T00:00:00.000Z" }), set: async () => { throw new Error("not used"); } },
  });
  const client = new Client({ name: "context-test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, pageStore };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    // Stores use better-sqlite3; the process closes test-local connections at
    // teardown and the temporary tree is not reused between tests.
    void dir;
  }
});

describe("MCP contextual reads", () => {
  it("provides public site/page/style/revision context and only curated documentation", async () => {
    const { client } = await connected();
    const siteResult = await client.callTool({ name: "get_site_context", arguments: {} });
    expect(siteResult.isError).toBeFalsy();
    const site = JSON.parse((siteResult.content as Array<{ text: string }>)[0].text);
    expect(site.pages.map((page: any) => page.slug)).toEqual(["public-page"]);
    expect(site.siteStyle.tokens.accent).toBe("#abc123");
    expect(site.documentation.some((doc: any) => doc.slug === "first-steps")).toBe(true);
    expect(JSON.stringify(site)).not.toContain("PRIVATE_MARKER");
    expect(JSON.stringify(site)).not.toContain("DRAFT_PRIVATE_MARKER");

    const pageResult = await client.callTool({ name: "get_page_context", arguments: { slug: "public-page" } });
    const page = JSON.parse((pageResult.content as Array<{ text: string }>)[0].text);
    expect(page.revision.revisionId).toBeTruthy();
    expect(page.revision.contentHash).toMatch(/^sha256:/);
    expect(page.revision.layout.root[0].props.text).toBe("Public content");
    expect(page.style.page.name).toBe("2pac-dark");

    const docResult = await client.callTool({ name: "read_documentation", arguments: { documentId: "first-steps" } });
    const doc = JSON.parse((docResult.content as Array<{ text: string }>)[0].text);
    expect(doc.slug).toBe("first-steps");
    expect(doc.markdown).toContain("Portaless");
    const deniedDoc = await client.callTool({ name: "read_documentation", arguments: { documentId: "../.airchive/private" } });
    expect(deniedDoc.isError).toBe(true);
    const deniedPrivate = await client.callTool({ name: "read_private_page_context", arguments: { slug: "private-page" } });
    expect(deniedPrivate.isError).toBe(true);
  });

  it("requires content:read and cannot retrieve drafts/private pages by guessed slug", async () => {
    const { client } = await connected({ granted: false });
    expect((await client.callTool({ name: "get_site_context", arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: "get_page_context", arguments: { slug: "private-page" } })).isError).toBe(true);
  });

  it("private page access requires its dedicated grant and cannot read published pages through that surface", async () => {
    const { client } = await connected({ privateGranted: true });
    const privateResult = await client.callTool({ name: "read_private_page_context", arguments: { slug: "private-page" } });
    const context = JSON.parse((privateResult.content as Array<{ text: string }>)[0].text);
    expect(context.title).toBe("PRIVATE_MARKER");
    expect(context.status).toBe("private");
    expect((await client.callTool({ name: "read_private_page_context", arguments: { slug: "public-page" } })).isError).toBe(true);
  });
});
