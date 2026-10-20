import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { ElementNode, PageLayout } from "../../../atomic-elements/src/types";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { isPubliclyPublishable } from "../../../deploy-engine/src/draft-filter";
import { elementNodeSchema, toolCatalog, checkNodeTypes } from "./element-node-schema";
import type { ResolvedCatalog } from "../../../atomic-elements/src/elements/element-pack";
import { diffPageLayouts } from "../../../atomic-elements/src/persistence/revision-diff";

const WRITE = "content:write" as const;
const PUBLISH = "content:publish" as const;

export interface RevisionProposalToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  resolveAgent: AgentIdentityResolver;
  elementCatalog?: ResolvedCatalog;
}

export function registerRevisionProposalTools(server: McpServer, deps: RevisionProposalToolDeps): void {
  server.registerTool("propose_page_revision", {
    title: "Proponer una revisión de una página publicada",
    description: "Crea una revisión borrador contra el revisionId base exacto de una página publicada. No cambia lo publicado. Requiere content:write; un revisor con content:publish debe aprobar el revisionId exacto.",
    inputSchema: {
      slug: z.string().min(1).max(200),
      baseRevisionId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      root: z.array(elementNodeSchema),
    },
  }, async ({ slug, baseRevisionId, title, description, root }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "propose_page_revision", capabilityId: WRITE, subjectId: slug,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, WRITE);
        const current = await deps.pageStore.load(slug);
        if (!current || !isPubliclyPublishable(current) || current.revisionId !== baseRevisionId) throw new Error("revision_conflict");
        const typeError = checkNodeTypes(root as ElementNode[], toolCatalog(deps.elementCatalog));
        if (typeError) throw new Error("invalid_element_type");
        if (!deps.pageStore.saveProposal) throw new Error("revision_proposals_unavailable");
        const proposed: PageLayout = {
          ...current,
          title,
          description: description ?? current.description,
          root: root as ElementNode[],
          status: "draft",
        };
        const revision = await deps.pageStore.saveProposal(proposed, baseRevisionId, agent.key);
        return { slug, ...revision };
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });

  server.registerTool("list_page_proposals", {
    title: "Listar revisiones pendientes de una página",
    description: "Devuelve propuestas no aprobadas. Requiere content:publish; el resultado puede contener contenido borrador.",
    inputSchema: { slug: z.string().min(1).max(200) },
  }, async ({ slug }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "list_page_proposals", capabilityId: PUBLISH, subjectId: slug,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, PUBLISH);
        if (!deps.pageStore.listPendingRevisions) throw new Error("revision_proposals_unavailable");
        const [proposals, history, current] = await Promise.all([
          deps.pageStore.listPendingRevisions(slug),
          deps.pageStore.listPublicRevisions?.(slug) ?? Promise.resolve([]),
          deps.pageStore.load(slug),
        ]);
        return proposals.map((proposal) => {
          const base = history.find((revision) => revision.revisionId === proposal.baseRevisionId)?.layout
            ?? (current?.revisionId === proposal.baseRevisionId ? current : null);
          const diff = base ? diffPageLayouts(base, proposal.layout) : null;
          return {
            slug,
            publicationId: proposal.publicationId,
            revisionId: proposal.revisionId,
            revisionNo: proposal.revisionNo,
            baseRevisionId: proposal.baseRevisionId,
            contentHash: proposal.contentHash,
            createdAt: proposal.createdAt,
            createdBy: proposal.createdBy,
            stale: current?.revisionId !== proposal.baseRevisionId,
            diff: diff?.changes ?? null,
            diffTruncated: diff?.truncated ?? false,
          };
        });
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });

  server.registerTool("approve_page_revision", {
    title: "Aprobar y publicar una revisión exacta",
    description: "Publica únicamente el revisionId exacto indicado. La aprobación queda inmutable y una revisión posterior necesita una nueva aprobación. Requiere content:publish.",
    inputSchema: { slug: z.string().min(1).max(200), revisionId: z.string().uuid() },
  }, async ({ slug, revisionId }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "approve_page_revision", capabilityId: PUBLISH,
      subjectId: slug, revisionId,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, PUBLISH);
        if (!deps.pageStore.approveRevision) throw new Error("revision_approval_unavailable");
        return deps.pageStore.approveRevision(slug, revisionId, agent.key);
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });
}
