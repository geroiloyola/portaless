// Tool de escritura: elimina UN bloque por nodeId, sin tocar el resto del
// arbol. Complemento natural de insert_block/update_block -- las tres cubren la
// manipulacion granular de nodos que antes exigia reemplazar `root` entero.
//
// Cuidado deliberado: no se verifica que el nodo tenga hijos. Eliminar una
// columna elimina lo que contiene; eso es el comportamiento esperado de un
// "borrar este bloque" y se documenta en la description de la tool.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { deleteNode } from "./node-ops";
import { isPubliclyPublishable } from "../../../deploy-engine/src/draft-filter";

const TOOL_NAME = "delete_block";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  nodeId: z.string().min(1).describe("Id del nodo a eliminar."),
};

export interface RegisterDeleteBlockToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  resolveAgent: AgentIdentityResolver;
}

export function registerDeleteBlockTool(server: McpServer, deps: RegisterDeleteBlockToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Eliminar un bloque por su id",
      description:
        "Elimina el nodo dado (por nodeId) de la pagina, sin tocar el resto del arbol. Si el " +
        "nodo es una columna, elimina tambien lo que contiene. Requiere 'content:read' para " +
        "leer y 'content:write' para guardar, ambas en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, nodeId }, extra?: AgentInvocationContext) => {
      const agent = await deps.resolveAgent(extra);
      await requireCapability(deps.permissionStore, agent, READ_CAPABILITY_ID);
      const existing = await deps.pageStore.load(slug);
      if (!existing) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: `No existe una pagina con slug '${slug}'.` }, null, 2) }],
          isError: true,
        };
      }

      await requireCapability(deps.permissionStore, agent, WRITE_CAPABILITY_ID);
      if (existing.status === "private") {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: "private_content_access_denied" }, null, 2) }],
          isError: true,
        };
      }
      if (isPubliclyPublishable(existing)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: "published_page_requires_admin_approval", message: "MCP no modifica una pagina publicada. Crea una propuesta borrador y pide a un admin que la revise y publique." }, null, 2) }],
          isError: true,
        };
      }
      const result = deleteNode(existing.root, nodeId);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: result.error }, null, 2) }],
          isError: true,
        };
      }

      const updated = { ...existing, root: result.root };
      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: agent.key,
        toolName: TOOL_NAME,
        capabilityId: WRITE_CAPABILITY_ID,
        run: () => deps.pageStore.save(updated),
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ saved: true, slug, deletedId: nodeId }, null, 2) }],
      };
    }
  );
}
