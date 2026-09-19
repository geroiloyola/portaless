// Tool de solo lectura: expone el registro dinamico real de plugins
// (packages/plugin-sandbox/src/registry/plugin-registry.ts, agregado en
// el PR #21), con su trustScore publico y transparente -- reemplaza,
// desde el lado del mcp-server, la necesidad de mirar el catalogo
// hardcodeado que functions/admin/permissions/index.js usaba antes de
// ese PR. Ver docs/architecture/mcp-agents.md, uso #2.
//
// No requiere capacidad: el registro es informativo (que plugins
// existen y su trustScore), no una accion sobre un plugin especifico.
// Conceder/revocar capacidades a un plugin puntual sigue pasando por
// grant_capability/revoke_permission, que si exigen site:admin.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginRegistryStore } from "../../../plugin-sandbox/src/registry/plugin-registry";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import { recordToolInvocation } from "../audit/record-tool-invocation";

const TOOL_NAME = "list_installed_plugins";

const inputSchema = {
  activeOnly: z.boolean().default(true).describe("Si true (default), solo lista plugins activos."),
};

export interface RegisterListInstalledPluginsToolDeps {
  pluginRegistry: PluginRegistryStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agentKeyId: string;
}

export function registerListInstalledPluginsTool(server: McpServer, deps: RegisterListInstalledPluginsToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Listar plugins instalados y su trustScore",
      description:
        "Devuelve el registro dinamico real de plugins (pluginId, displayName, author, sourceType " +
        "'open'/'closed', requestedCapabilities, trustScore, trustScoreVotes, auditedBy si aplica). " +
        "El trustScore es un promedio de votos 1-5 de la comunidad, no una certificacion de Portaless.",
      inputSchema,
    },
    async ({ activeOnly }) => {
      const result = await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: deps.agentKeyId,
        toolName: TOOL_NAME,
        capabilityId: null,
        run: () => deps.pluginRegistry.list(activeOnly),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
