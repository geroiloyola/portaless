// Servidor MCP base de Portaless.
//
// Principio rector (no negociable, ver mcp-agents.md): ninguna tool
// que se registre aqui debe tocar datos reales sin pasar antes por
// PermissionStore (packages/permissions) para verificar que el agente
// invocante tiene la capacidad concedida. Este archivo crea el servidor
// Y conecta las tools -- ver createPortalessMcpServerDeps para lo que
// index.ts debe resolver antes de llamar a createPortalessMcpServer().
//
// Identidad por invocacion (Opcion B, AGENT.md): deps.resolveAgent se
// ejecuta en CADA invocacion de tool -- sobre transporte HTTP resuelve
// el bearer token de esa peticion contra McpAgentTokenStore (dos tokens
// distintos = dos identidades con permisos y auditoria separados); sobre
// stdio el resolver de env devuelve la identidad fija del proceso
// (Opcion A, limitacion del SDK que no expone authInfo en stdio). Este
// archivo no distingue el transporte: solo propaga el resolver.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../atomic-elements/src/persistence/page-store";
import type { ResolvedCatalog } from "../../atomic-elements/src/elements/element-pack";
import type { ThemePack } from "../../atomic-elements/src/themes/theme-pack";
import type { PermissionStore } from "../../permissions/src/permission-store";
import type { PluginRegistryStore } from "../../plugin-sandbox/src/registry/plugin-registry";
import type { AuditLogStore } from "./audit/types";
import type { UsageLedgerStore } from "../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver } from "./permissions/agent-identity";
import { registerCreatePageTool } from "./tools/create-page";
import { registerUpdatePageTool } from "./tools/update-page";
import { registerInsertBlockTool } from "./tools/insert-block";
import { registerUpdateBlockTool } from "./tools/update-block";
import { registerDeleteBlockTool } from "./tools/delete-block";
import { registerGrantCapabilityTool } from "./tools/grant-capability";
import { registerRevokePermissionTool } from "./tools/revoke-permission";
import { registerListPageComponentsTool } from "./tools/list-page-components";
import { registerListThemesTool } from "./tools/list-themes";
import { registerApplyThemeTool } from "./tools/apply-theme";
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
  /** Resolver de identidad del agente invocante, ejecutado POR INVOCACION en cada tool. */
  resolveAgent: AgentIdentityResolver;
  /**
   * Catalogo de elementos (core ∪ element packs) resuelto por index.ts antes
   * de arrancar. Las tools de contenido y list_page_components lo usan para
   * decidir MEMBERSHIP de tipos y para mostrar los packs instalados --
   * ver docs/architecture/element-catalog-plugins.md. Opcional para mantener
   * retro-compatibilidad con callers que solo quieren el core.
   */
  elementCatalog?: ResolvedCatalog;
  /**
   * Temas de pagina (builtin ∪ instalados, ya deduplicados con
   * availableThemes()) resuelto por index.ts. Lo usan list_themes y
   * apply_theme para membership. Opcional: sin el, solo los builtins.
   */
  themes?: ThemePack[];
}

/** Solo stores (sin resolver) -- lo que el servidor HTTP comparte entre peticiones. */
export type McpStoreDeps = Omit<CreatePortalessMcpServerDeps, "resolveAgent">;

export function createPortalessMcpServer(deps: CreatePortalessMcpServerDeps): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Tools de solo lectura primero (menor riesgo, sin requireCapability
  // interno mas alla de list_page_components que no necesita ninguna).
  registerListPageComponentsTool(server, { elementCatalog: deps.elementCatalog });
  registerListThemesTool(server, { themes: deps.themes });
  registerQueryUsageLogTool(server, {
    usageLedger: deps.usageLedger,
    auditLog: deps.auditLog,
    resolveAgent: deps.resolveAgent,
  });
  registerListInstalledPluginsTool(server, {
    pluginRegistry: deps.pluginRegistry,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
  });

  // Tools de contenido (requieren content:write / content:read, ver
  // requireCapability dentro de cada una).
  registerCreatePageTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
    elementCatalog: deps.elementCatalog,
  });
  registerUpdatePageTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
    elementCatalog: deps.elementCatalog,
  });
  registerApplyThemeTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
    themes: deps.themes,
  });
  registerInsertBlockTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
    elementCatalog: deps.elementCatalog,
  });
  registerUpdateBlockTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
  });
  registerDeleteBlockTool(server, {
    pageStore: deps.pageStore,
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
  });

  // Tools de administracion (requieren site:admin -- ver la nota de
  // riesgo de auto-escalada en grant-capability.ts antes de conceder
  // site:admin al agente que corre este proceso).
  registerGrantCapabilityTool(server, {
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
  });
  registerRevokePermissionTool(server, {
    permissionStore: deps.permissionStore,
    auditLog: deps.auditLog,
    usageLedger: deps.usageLedger,
    resolveAgent: deps.resolveAgent,
  });

  return server;
}
