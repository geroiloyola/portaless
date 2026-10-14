// Tool de escritura: crea una pagina nueva via PageStore.save() real
// (packages/atomic-elements/src/persistence/page-store.ts), que ya
// valida el PageLayout con validatePageLayout internamente -- este
// archivo NO reimplementa esa validacion.
//
// Principio del whitepaper (ver docs/architecture/mcp-agents.md):
// "toda escritura de un agente se guarda como borrador, nunca se
// publica directo". PageLayout ahora tiene `status` nativo
// ("draft"/"published"), asi que draftMode=true (default) marca
// status="draft" y el slug queda limpio. Publicar es llamar a
// update_page con status="published" una vez que un humano lo aprueba.
//
// NOTA (legacy): hasta v0.0.9.10 el borrador se marcaba con un sufijo
// "-draft" en el slug, y el publish filter (deploy-engine/draft-filter)
// seguia ese sufijo para excluirlo. Las paginas creadas con ese mecanismo
// siguen existiendo con su slug "-draft" y el filtro las excluye igual;
// no se migran. El filtro ahora excluye ambos mecanismos.
//
// El schema del arbol de bloques (elementNodeSchema) vive en
// element-node-schema.ts y se deriva de elementRegistry -- no se hardcodea
// aqui, para que un ElementType nuevo sea aceptado automaticamente.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PageLayout, ElementNode } from "../../../atomic-elements/src/types";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { elementNodeSchema, toolCatalog, checkNodeTypes } from "./element-node-schema";
import type { ResolvedCatalog } from "../../../atomic-elements/src/elements/element-pack";

const TOOL_NAME = "create_page";
const CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina, ej. 'contacto'. Se usa tal cual (el borrador NO altera el slug)."),
  title: z.string().min(1),
  description: z.string().optional(),
  root: z.array(elementNodeSchema).describe("Arbol de bloques -- usar solo ElementType listados por list_page_components."),
  draftMode: z.boolean().default(true).describe("Si true (default), guarda con status='draft' hasta aprobacion humana (publicar via update_page con status='published')."),
};

export interface RegisterCreatePageToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  /** Identidad del agente invocante, resuelta POR INVOCACION (ver permissions/agent-identity.ts). */
  resolveAgent: AgentIdentityResolver;
  /** Catalogo core ∪ packs resuelto por server.ts. Opcional: sin el, solo el core. */
  elementCatalog?: ResolvedCatalog;
}

export function registerCreatePageTool(server: McpServer, deps: RegisterCreatePageToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Crear una pagina nueva (borrador por defecto)",
      description:
        "Crea un PageLayout y lo guarda via PageStore real. Por defecto (draftMode=true) el " +
        "status queda en 'draft', para que un humano revise el contenido antes de publicarlo " +
        "con update_page y status='published'. Requiere la capacidad 'content:write' concedida " +
        "en el Centro de Permisos.",
      inputSchema,
    },
    async ({ slug, title, description, root, draftMode }, extra?: AgentInvocationContext) => {
      const agent = await deps.resolveAgent(extra);
      await requireCapability(deps.permissionStore, agent, CAPABILITY_ID);

      // Autoridad de membership: el schema Zod solo valida la FORMA (acepta
      // cualquier string namespaced). Aqui se decide que tipos existen hoy en
      // el catalogo resuelto (core ∪ element packs) -- v0.0.9.11.
      const typeError = checkNodeTypes(root as ElementNode[], toolCatalog(deps.elementCatalog));
      if (typeError) {
        return {
          content: [{ type: "text", text: JSON.stringify({ saved: false, error: typeError }, null, 2) }],
          isError: true,
        };
      }

      const layout: PageLayout = {
        version: "0.1",
        slug,
        title,
        description,
        status: draftMode ? "draft" : "published",
        root: root as ElementNode[],
      };

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: agent.key,
        toolName: TOOL_NAME,
        capabilityId: CAPABILITY_ID,
        run: () => deps.pageStore.save(layout),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { saved: true, slug, status: layout.status, note: draftMode ? "Guardado como borrador (status='draft'). Un humano lo publica con update_page + status='published'." : "Guardado como publicado (status='published')." },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
