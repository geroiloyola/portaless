// Tool de escritura: crea una pagina nueva via PageStore.save() real
// (packages/atomic-elements/src/persistence/page-store.ts), que ya
// valida el PageLayout con validatePageLayout internamente -- este
// archivo NO reimplementa esa validacion.
//
// Principio del whitepaper (ver docs/architecture/mcp-agents.md):
// "toda escritura de un agente se guarda como borrador, nunca se
// publica directo". Este commit lo aplica de la forma mas simple
// posible dado lo que existe hoy en PageStore (que no tiene un campo
// `status: draft/published`): antepone un sufijo `-draft` al slug
// cuando draftMode=true (default). Promover un borrador a publicado
// significa, en este esquema, volver a llamar a create_page/update_page
// con el slug final sin sufijo -- una vez que un humano lo aprueba.
// Si PageStore evoluciona a tener un campo de estado nativo, este
// mecanismo deberia migrar a usarlo en vez del sufijo de slug.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PageLayout, ElementNode } from "../../../atomic-elements/src/types";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentity } from "../permissions/types";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";

const TOOL_NAME = "create_page";
const CAPABILITY_ID = "content:write";

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
  slug: z.string().min(1).describe("Slug de la pagina, ej. 'contacto'. Se usa tal cual si draftMode=false."),
  title: z.string().min(1),
  description: z.string().optional(),
  root: z.array(elementNodeSchema).describe("Arbol de bloques -- usar solo ElementType listados por list_page_components."),
  draftMode: z.boolean().default(true).describe("Si true (default), guarda con sufijo '-draft' en el slug hasta aprobacion humana."),
};

export interface RegisterCreatePageToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agent: AgentIdentity;
}

export function registerCreatePageTool(server: McpServer, deps: RegisterCreatePageToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Crear una pagina nueva (borrador por defecto)",
      description:
        "Crea un PageLayout y lo guarda via PageStore real. Por defecto (draftMode=true) el slug " +
        "queda con sufijo '-draft', para que un humano revise el contenido antes de publicarlo con " +
        "el slug final. Requiere la capacidad 'content:write' concedida en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, title, description, root, draftMode }) => {
      await requireCapability(deps.permissionStore, deps.agent, CAPABILITY_ID);

      const finalSlug = draftMode ? `${slug}-draft` : slug;
      const layout: PageLayout = {
        version: "0.1",
        slug: finalSlug,
        title,
        description,
        root: root as ElementNode[],
      };

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: deps.agent.key,
        toolName: TOOL_NAME,
        capabilityId: CAPABILITY_ID,
        run: () => deps.pageStore.save(layout),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { saved: true, slug: finalSlug, draftMode, note: draftMode ? "Guardado como borrador. Revisar y volver a llamar con draftMode=false para publicar." : "Guardado con el slug final." },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
