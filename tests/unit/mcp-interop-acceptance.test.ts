// C33 local acceptance evidence: the complete editor loop through the real
// MCP server and SDK client:
// connect -> read authorized context -> edit a block -> save a draft proposal
// -> review diff -> approve exact revision -> read published revision.
//
// This is deterministic local evidence, not a claim that an external ChatGPT
// account or a specific model passed. The external row lives in
// docs/testing/interop-evidence.json and stays blocked until a real run.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";
import { createPortalessMcpServer } from "../../packages/mcp-server/src/server";

const AGENT = { key: "interop-acceptance-agent", displayName: "Interop Acceptance Agent" };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function text(result: { content: unknown[] }): any {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

describe("C33 local MCP acceptance flow", () => {
  it("connects, reads context, edits a block, saves a draft, approves and reads the published revision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portaless-interop-"));
    dirs.push(dir);
    const pageStore = await createPageStore({ PORTALESS_SQLITE_PATH: join(dir, "pages.sqlite") });
    const baseline = await pageStore.save({
      version: "0.1",
      slug: "home",
      title: "Published v1",
      status: "published",
      root: [{ id: "hero", type: "Hero", props: { headline: "Before" } }],
    }, { expectedRevisionId: null, actor: "owner" });

    const permissionStore = new InMemoryPermissionStore();
    for (const capabilityId of ["content:read", "content:write", "content:publish"] as const) {
      await permissionStore.setGrant({
        subject: { type: "agent", id: AGENT.key, displayName: AGENT.displayName },
        capabilityId,
        granted: true,
        grantedBy: "owner",
      });
    }

    const server = createPortalessMcpServer({
      pageStore,
      permissionStore,
      pluginRegistry: { list: async () => [] } as never,
      auditLog: new InMemoryAuditLogStore(),
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent: createEnvAgentIdentityResolver({ MCP_AGENT_KEY: AGENT.key, MCP_AGENT_DISPLAY_NAME: AGENT.displayName } as NodeJS.ProcessEnv),
    });
    const client = new Client({ name: "interop-acceptance-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. Connect and read authorized site context.
    const site = text(await client.callTool({ name: "get_site_context", arguments: {} }) as never);
    expect(site.pages).toContainEqual(expect.objectContaining({ slug: "home", revisionId: baseline.revisionId }));

    const context = text(await client.callTool({ name: "get_page_context", arguments: { slug: "home" } }) as never);
    expect(context.revision.revisionId).toBe(baseline.revisionId);
    expect(context.revision.layout.root[0].props.headline).toBe("Before");

    // 2–3. Propose an atomic edit against the exact public base; the published
    // page must not change.
    const proposed = text(await client.callTool({
      name: "propose_page_revision",
      arguments: {
        slug: "home",
        baseRevisionId: baseline.revisionId,
        title: "Published v2",
        root: [{ id: "hero", type: "Hero", props: { headline: "After" } }],
      },
    }) as never);
    expect(proposed.parentRevisionId).toBe(baseline.revisionId);
    expect((await pageStore.load("home"))?.title).toBe("Published v1");

    // 4–5. Reviewer lists the bounded diff and approves that exact revision.
    const proposals = text(await client.callTool({ name: "list_page_proposals", arguments: { slug: "home" } }) as never);
    expect(proposals).toContainEqual(expect.objectContaining({
      revisionId: proposed.revisionId,
      baseRevisionId: baseline.revisionId,
      stale: false,
    }));
    expect(proposals[0].diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "title", before: "Published v1", after: "Published v2" }),
    ]));

    await client.callTool({ name: "approve_page_revision", arguments: { slug: "home", revisionId: proposed.revisionId } });

    // 6–7. Follow-up read resolves the published revision.
    const published = text(await client.callTool({ name: "get_page_context", arguments: { slug: "home" } }) as never);
    expect(published.revision.revisionId).toBe(proposed.revisionId);
    expect(published.revision.layout.root[0].props.headline).toBe("After");
    expect(await pageStore.load("home")).toMatchObject({
      title: "Published v2",
      status: "published",
      revisionId: proposed.revisionId,
    });

    await client.close();
    await server.close();
  });
});
