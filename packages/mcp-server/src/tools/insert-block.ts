// Tool de escritura: inserta UN bloque en una posicion concreta del arbol de
// una pagina existente, sin reemplazar el arbol completo (que es lo unico que
// permitia update_page). Direcciona el destino por parentId (+ slotIndex para
// columnas) e index, y el nodo se valida con el mismo elementNodeSchema
// derivado del registro que usan create_page/update_page.
//
// Principio del whitepaper (docs/architecture/mcp-agents.md): toda escritura
// de un agente pasa por PageStore.save(), que valida el layout con
// validatePageLayout. Igual que update_page, esta tool NO impone borrador -- el
// control de publicacion es responsabilidad del flujo de aprobacion humano.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { elementNodeSchema, toolCatalog, checkNodeTypes } from "./element-node-schema";
import { insertNode } from "./node-ops";
import type { ResolvedCatalog } from "../../../atomic-elements/src/elements/element-pack";
import type { ElementNode } from "../../../atomic-elements/src/types";

const TOOL_NAME = "insert_block";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  parentId: z
    .string()
    .optional()
    .describe("Id del nodo padre donde insertar. Omitir para insertar en el root (nivel superior)."),
  slotIndex: z
    .number()
    .int()
    .optional()
    .describe(
      "Solo si el padre tiene columnSlots: que slot (columna) recibe el bloque. Default 0."
    ),
  index: z
    .number()
    .int()
    .min(0)
    .describe("Posicion dentro del contenedor (0..length). Fuera de rango es error, no se recorta."),
  node: elementNodeSchema.describe("El bloque a insertar (id debe ser nuevo/unico en la pagina)."),
};

export interface RegisterInsertBlockToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  resolveAgent: AgentIdentityResolver;
  /** Catalogo core ∪ packs resuelto por server.ts. Opcional: sin el, solo el core. */
  elementCatalog?: ResolvedCatalog;
}

export function registerInsertBlockTool(server: McpServer, deps: RegisterInsertBlockToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Insertar un bloque en una posicion del arbol",
      description:
        "Inserta un nodo en la pagina dada, en el contenedor apuntado por parentId (+ slotIndex " +
        "para columnas) y en el indice indicado, sin tocar el resto del arbol. Requiere " +
        "'content:read' para leer y 'content:write' para guardar, ambas en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, parentId, slotIndex, index, node }, extra?: AgentInvocationContext) => {
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

      // Autoridad de membership sobre el nodo a insertar -- v0.0.9.11.
      const typeError = checkNodeTypes([node as ElementNode], toolCatalog(deps.elementCatalog));
      if (typeError) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: typeError }, null, 2) }],
          isError: true,
        };
      }

      const result = insertNode(existing.root, parentId, index, node, slotIndex);
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
        content: [{ type: "text", text: JSON.stringify({ saved: true, slug, insertedId: node.id }, null, 2) }],
      };
    }
  );
}
