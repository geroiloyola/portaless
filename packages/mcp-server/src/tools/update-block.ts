// Tool de escritura: actualiza las props de UN bloque existente por nodeId,
// sin tocar children ni columnSlots ni el resto del arbol. Es la granularidad
// que faltaba: update_page solo podia reemplazar `root` entero.
//
// El patch es superficial: las claves provistas se sobreescriben (o se
// eliminan si el valor es undefined); las demas props del nodo se conservan.
// Para insertar/eliminar bloques esta insert_block/delete_block.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { updateNodeProps } from "./node-ops";

const TOOL_NAME = "update_block";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  nodeId: z.string().min(1).describe("Id del nodo cuyas props se actualizan."),
  props: z
    .record(z.unknown())
    .describe(
      "Patch superficial de props: claves provistas se sobreescriben (undefined las elimina); el resto se conserva."
    ),
};

export interface RegisterUpdateBlockToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  resolveAgent: AgentIdentityResolver;
}

export function registerUpdateBlockTool(server: McpServer, deps: RegisterUpdateBlockToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Actualizar las props de un bloque por su id",
      description:
        "Aplica un patch superficial sobre las props del nodo dado (por nodeId) en la pagina, " +
        "sin tocar children ni el resto del arbol. Requiere 'content:read' para leer y " +
        "'content:write' para guardar, ambas en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, nodeId, props }, extra?: AgentInvocationContext) => {
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
      const result = updateNodeProps(existing.root, nodeId, props);
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
        content: [{ type: "text", text: JSON.stringify({ saved: true, slug, nodeId }, null, 2) }],
      };
    }
  );
}
