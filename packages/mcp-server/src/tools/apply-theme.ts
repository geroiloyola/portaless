// Tool de escritura: aplica (o quita) un tema de pagina -- escribe
// PageLayout.theme. El look lo resuelve el render en ambos caminos (build
// estatico y runtime), igual que `status`: esta tool solo fija la
// intencion.
//
// Membership contra el catalogo builtin ∪ instalados (resolveThemePack):
// un nombre inexistente o con la cadena "extends" rota produce un error
// accionable que lista los nombres disponibles -- el mismo contrato de
// errores accionables que checkNodeTypes aplica a los tipos de elemento.
// theme = null borra el campo y la pagina vuelve al skin del sitio.
// Mismo flujo de capabilities/auditoria que update_page: content:read para
// leer, content:write para guardar, recordToolInvocation para el ledger.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import type { ThemePack } from "../../../atomic-elements/src/themes/theme-pack";
import { BUILTIN_THEMES, resolveThemePack } from "../../../atomic-elements/src/themes/theme-pack";

const TOOL_NAME = "apply_theme";
const READ_CAPABILITY_ID = "content:read";
const WRITE_CAPABILITY_ID = "content:write";

const inputSchema = {
  slug: z.string().min(1).describe("Slug de la pagina existente a modificar."),
  theme: z
    .string()
    .min(1)
    .nullable()
    .describe("Nombre de un tema (ver list_themes) o null para quitarlo y volver al skin del sitio."),
};

export interface RegisterApplyThemeToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  /** Identidad del agente invocante, resuelta POR INVOCACION. */
  resolveAgent: AgentIdentityResolver;
  /** builtin ∪ instalados, resuelto por index.ts. Opcional: sin el, solo builtins. */
  themes?: ThemePack[];
}

export function registerApplyThemeTool(server: McpServer, deps: RegisterApplyThemeToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Aplicar un tema de pagina",
      description:
        "Escribe PageLayout.theme en una pagina existente para darle su propio look (por " +
        "pagina, heredando el resto del skin del sitio). `theme` null borra el campo. " +
        "Requiere 'content:read' para leer y 'content:write' para guardar, ambas concedidas " +
        "en el Centro de Permisos. Los nombres validos salen de list_themes.",
      inputSchema,
    },
    async ({ slug, theme }, extra?: AgentInvocationContext) => {
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

      const catalog = deps.themes ?? [...BUILTIN_THEMES];
      if (theme !== null && !resolveThemePack(catalog, theme)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  saved: false,
                  error: `El tema '${theme}' no existe o su cadena 'extends' esta rota. Temas disponibles: ${catalog
                    .map((t) => t.name)
                    .join(", ")}.`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const updated = { ...existing };
      if (theme === null) {
        delete updated.theme;
      } else {
        updated.theme = theme;
      }

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: agent.key,
        toolName: TOOL_NAME,
        capabilityId: WRITE_CAPABILITY_ID,
        run: () => deps.pageStore.save(updated),
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ saved: true, slug, theme: theme ?? null }, null, 2) }],
      };
    }
  );
}
