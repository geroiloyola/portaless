// Servidor MCP base de Portaless.
//
// Principio rector (no negociable, ver mcp-agents.md): ninguna tool
// que se registre aqui debe tocar datos reales sin pasar antes por
// PermissionStore (packages/permissions) para verificar que el agente
// invocante tiene la capacidad concedida. Este archivo crea el servidor
// Y conecta las tools -- ver createPortalessMcpServerDeps para lo que
// index.ts debe resolver antes de llamar a createPortalessMcpServer().
//
// LIMITACION CONOCIDA (Opcion A, ver AGENT.md y docs/architecture/
// mcp-agents.md): el SDK de MCP no expone hoy un mecanismo de sesion
// por invocacion sobre StdioServerTransport, asi que AgentIdentity se
// resuelve UNA SOLA VEZ al arrancar el proceso (variables de entorno
// MCP_AGENT_KEY / MCP_AGENT_DISPLAY_NAME, ver index.ts), no por cada
// llamada. Esto significa que todo el proceso stdio actua como un unico
// agente fijo, sin verificacion criptografica real -- a diferencia de
// Web Bot Auth (packages/trust-layer), que si verifica firma Ed25519
// por request HTTP. Una identidad de agente real y verificada para el
// transporte stdio (Opcion B) queda fuera de alcance de este commit;
// ver "Proximo paso recomendado" en AGENT.md para no repetir el error
// de declarar esto como resuelto antes de que lo este de verdad.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../permissions/src/permission-store";
import type { PluginRegistryStore } from "../../plugin-sandbox/src/registry/plugin-registry";
import type { AuditLogStore } from "./audit/types";
import type { UsageLedgerStore } from "../../trust-layer/src/ledger/log-writer";
import type { AgentIdentity } from "./permissions/types";
import { registerCreatePageTool } from "./tools/create-page";
import { registerUpdatePageTool } from "./tools/update-page";
import { registerGrantCapabilityTool } from "./tools/grant-capability";
import { registerRevokePermissionTool } from "./tools/revoke-permission";
import { registerListPageComponentsTool } from "./tools/list-page-components";
import { registerListInstalledPluginsTool } from "./tools/list-installed-plugins";
import { registerQueryUsageLogTool } from "./tools/query-usage-log";

export const SERVER_NAME = "portaless-mcp-server";
export const SERVER_VERSION = "0.0.1";

/**
 * Dependencias reales que index.ts debe resolver (via store-factory de
 * cada paquete: createPageStore, createPermissionStore, etc.) antes de
 * llamar a createPortalessMcpServer(). Ningun store se instancia aqui
 * -- este archivo solo cablea tools sobre stores ya construidos, mismo
 * principio de inversion de dependencias que ya usan los stores
 * multi-proveedor (D1/SQLite) del resto del monorepo.
 */
export interface CreatePortalessMcpServerDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  pluginRegistry: PluginRegistryStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agent: AgentIdentity;
}

export function createPortalessMcpServer(deps: CreatePortalessMcpServerDeps): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Tools de solo lectura primero (menor riesgo, sin requireCapability
  // interno mas alla de list_page_components que no necesita ninguna).
  registerListPageComponentsTool(server);
  registerQueryUsageLogTool(server, {
    usageLedger: deps.usageLedger,
    auditLog: deps.auditLog,
    agentKeyId: deps.agent.key,
  });
  registerListInstalledPluginsTool(server, {
    pluginRegistry: deps.pluginRegistry,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    agentKeyId: deps.agent.key,
  });

  // Tools de contenido (requieren content:write / content:read, ver
  // requireCapability dentro de cada una).
  registerCreatePageTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    agent: deps.agent,
  });
  registerUpdatePageTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    agent: deps.agent,
  });

  // Tools de administracion (requieren site:admin -- ver la nota de
  // riesgo de auto-escalada en grant-capability.ts antes de conceder
  // site:admin al agente que corre este proceso).
  registerGrantCapabilityTool(server, {
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    agent: deps.agent,
  });
  registerRevokePermissionTool(server, {
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    agent: deps.agent,
  });

  return server;
}
