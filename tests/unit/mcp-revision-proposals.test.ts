import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { registerRevisionProposalTools } from "../../packages/mcp-server/src/tools/revision-proposals";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";

const agent = { key: "proposal-reviewer", displayName: "Proposal Reviewer" };

async function setup() {
  const pageStore = await createPageStore({ PORTALESS_SQLITE_PATH: ":memory:" });
  const baseline = await pageStore.save({ version: "0.1", slug: "home", title: "Published v1", status: "published", root: [] }, { expectedRevisionId: null, actor: "owner" });
  const permissionStore = new InMemoryPermissionStore();
  const subject = { type: "agent" as const, id: agent.key, displayName: agent.displayName };
  await permissionStore.setGrant({ subject, capabilityId: "content:write", granted: true, grantedBy: "owner" });
  const server = new McpServer({ name: "proposal-test", version: "0.0.1" });
  registerRevisionProposalTools(server, {
    pageStore,
    permissionStore,
    auditLog: new InMemoryAuditLogStore(),
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent: createEnvAgentIdentityResolver({ MCP_AGENT_KEY: agent.key, MCP_AGENT_DISPLAY_NAME: agent.displayName } as NodeJS.ProcessEnv),
  });
  const client = new Client({ name: "proposal-test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, pageStore, permissionStore, subject, baseline };
}

function resultObject(result: { content: unknown[] }) {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

describe("MCP revision proposals", () => {
  it("creates a proposal against an exact public base and only publishes after the same revision is approved", async () => {
    const { client, pageStore, permissionStore, subject, baseline } = await setup();
    const proposalResult = await client.callTool({ name: "propose_page_revision", arguments: {
      slug: "home", baseRevisionId: baseline.revisionId, title: "Published v2", root: [],
    } });
    expect(proposalResult.isError).toBeFalsy();
    const proposal = resultObject(proposalResult as never);
    expect(proposal.revisionId).toBeTruthy();
    expect(proposal.parentRevisionId).toBe(baseline.revisionId);
    expect((await pageStore.load("home"))?.title).toBe("Published v1");

    expect((await client.callTool({ name: "list_page_proposals", arguments: { slug: "home" } })).isError).toBe(true);
    await permissionStore.setGrant({ subject, capabilityId: "content:publish", granted: true, grantedBy: "owner" });
    const proposals = await client.callTool({ name: "list_page_proposals", arguments: { slug: "home" } });
    const listed = resultObject(proposals as never);
    expect(listed.map((item: { revisionId: string }) => item.revisionId)).toContain(proposal.revisionId);
    expect(listed[0]).toMatchObject({ stale: false, diff: [{ path: "title", before: "Published v1", after: "Published v2" }] });

    const approved = await client.callTool({ name: "approve_page_revision", arguments: { slug: "home", revisionId: proposal.revisionId } });
    expect(approved.isError).toBeFalsy();
    const current = await pageStore.load("home");
    expect(current).toMatchObject({ title: "Published v2", status: "published", revisionId: proposal.revisionId });
    expect((await pageStore.listPublicRevisions?.("home"))?.[0].revisionId).toBe(proposal.revisionId);

    const nextProposal = await client.callTool({ name: "propose_page_revision", arguments: {
      slug: "home", baseRevisionId: proposal.revisionId, title: "Published v3", root: [],
    } });
    const next = resultObject(nextProposal as never);
    expect(next.revisionId).not.toBe(proposal.revisionId);
    expect((await pageStore.load("home"))?.title).toBe("Published v2");
    expect((await pageStore.listPublicRevisions?.("home"))?.[0].revisionId).toBe(proposal.revisionId);
    expect((await pageStore.listPendingRevisions?.("home"))?.map((pending) => pending.revisionId)).toContain(next.revisionId);
  });

  it("rejects a proposal based on a stale public revision", async () => {
    const { client, baseline } = await setup();
    const staleProposal = await client.callTool({ name: "propose_page_revision", arguments: {
      slug: "home", baseRevisionId: "00000000-0000-4000-8000-000000000000", title: "Stale", root: [],
    } });
    expect(staleProposal.isError).toBe(true);
    expect(baseline.revisionId).not.toBe("00000000-0000-4000-8000-000000000000");
  });
});
