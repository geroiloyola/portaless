// Tool de escritura: actualiza una pagina existente. Usa PageStore.load()
// para leer el layout actual y aplica un merge superficial de los campos
// provistos -- no permite reemplazar `root` parcialmente (un ElementNode[]
// completo reemplaza al anterior si se provee, ya que un merge profundo
// de arbol de bloques requeriria una estrategia de diffing que no existe
// hoy en PageStore ni en atomic-elements y no se debe improvisar aqui).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { ElementNode } from "../../../atomic-elements/src/types";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentity } from "../permissions/types";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";

const TOOL_NAME = "update_page";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const elementNodeSchema: z.ZodType<ElementNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(["Hero", "Heading", "Paragraph", "Image", "Button", "Columns", "ProductGrid", "Spacer"]),
    props: z.record(z.unknown()),
    children: z.array(elementNodeSchema).optional(),
    columnSlots: z.array(z.array(elementNodeSchema)).optional(),
  })
);

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  root: z.array(elementNodeSchema).optional().describe("Si se provee, reemplaza el arbol de bloques completo."),
};

export interface RegisterUpdatePageToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agent: AgentIdentity;
}

export function registerUpdatePageTool(server: McpServer, deps: RegisterUpdatePageToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Actualizar una pagina existente",
      description:
        "Lee una pagina existente via PageStore.load() y aplica los campos provistos (merge " +
        "superficial; `root`, si se provee, reemplaza el arbol completo). Requiere 'content:read' " +
        "para leer y 'content:write' para guardar, ambas concedidas en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, title, description, root }) => {
      await requireCapability(deps.permissionStore, deps.agent, READ_CAPABILITY_ID);
      const existing = await deps.pageStore.load(slug);
      if (!existing) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: `No existe una pagina con slug '${slug}'.` }, null, 2) }],
          isError: true,
        };
      }

      await requireCapability(deps.permissionStore, deps.agent, WRITE_CAPABILITY_ID);
      const updated = {
        ...existing,
        title: title ?? existing.title,
        description: description ?? existing.description,
        root: (root as ElementNode[] | undefined) ?? existing.root,
      };

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: deps.agent.key,
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
