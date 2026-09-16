// Servidor MCP base de Portaless. Sin tools registradas todavia --
// ver commits siguientes (permisos, auditoria, tools de contenido y
// administracion) descritos en docs/architecture/mcp-agents.md.
//
// Principio rector (no negociable, ver mcp-agents.md): ninguna tool
// que se registre aqui en el futuro debe tocar datos reales sin pasar
// antes por PermissionStore (packages/permissions) para verificar que
// el agente invocante tiene la capacidad concedida. Este archivo solo
// crea el servidor; el middleware de permisos se agrega en el commit 2.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_NAME = "portaless-mcp-server";
export const SERVER_VERSION = "0.0.1";

export function createPortalessMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  return server;
}
