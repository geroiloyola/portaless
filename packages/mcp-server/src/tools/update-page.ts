// Tool de escritura: actualiza una pagina existente. Usa PageStore.load()
// para leer el layout actual y aplica un merge superficial de los campos
// provistos -- no permite reemplazar `root` parcialmente (un ElementNode[]
// completo reemplaza al anterior si se provee, ya que un merge profundo
// de arbol de bloques requeriria una estrategia de diffing que no existe
// hoy en PageStore ni en atomic-elements y no se debe improvisar aqui).
//
// El schema del arbol de bloques (elementNodeSchema) vive en
// element-node-schema.ts y se deriva de elementRegistry -- no se hardcodea
// aqui, para que un ElementType nuevo sea aceptado automaticamente.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { ElementNode } from "../../../atomic-elements/src/types";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { elementNodeSchema } from "./element-node-schema";

const TOOL_NAME = "update_page";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z
    .enum(["draft", "published"])
    .optional()
    .describe("Cambia el estado de publicacion. 'published' promueve un borrador (flujo de aprobacion humana)."),
  root: z.array(elementNodeSchema).optional().describe("Si se provee, reemplaza el arbol de bloques completo."),
};

export interface RegisterUpdatePageToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  /** Identidad del agente invocante, resuelta POR INVOCACION (ver permissions/agent-identity.ts). */
  resolveAgent: AgentIdentityResolver;
}

export function registerUpdatePageTool(server: McpServer, deps: RegisterUpdatePageToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Actualizar una pagina existente",
      description:
        "Lee una pagina existente via PageStore.load() y aplica los campos provistos (merge " +
        "superficial; `root`, si se provee, reemplaza el arbol completo; `status` cambia el " +
        "estado de publicacion). Requiere 'content:read' para leer y 'content:write' para " +
        "guardar, ambas concedidas en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, title, description, status, root }, extra?: AgentInvocationContext) => {
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
      const updated = {
        ...existing,
        title: title ?? existing.title,
        description: description ?? existing.description,
        status: status ?? existing.status,
        root: (root as ElementNode[] | undefined) ?? existing.root,
      };

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: agent.key,
        toolName: TOOL_NAME,
        capabilityId: WRITE_CAPABILITY_ID,
        run: () => deps.pageStore.save(updated),
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ saved: true, slug }, null, 2) }],
      };
    }
  );
}
