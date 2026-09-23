#!/usr/bin/env node
// Entrypoint del servidor MCP de Portaless. Corre sobre stdio, pensado
// para ser lanzado como proceso hijo por un cliente MCP (Claude Desktop,
// Cursor, etc.), siguiendo el patron estandar del SDK oficial.
//
// LIMITACION CONOCIDA (Opcion A, ver AGENT.md y la nota completa en
// server.ts): AgentIdentity se resuelve UNA SOLA VEZ aqui, desde
// variables de entorno (MCP_AGENT_KEY / MCP_AGENT_DISPLAY_NAME), no por
// invocacion -- el SDK de MCP no expone hoy sesion por llamada sobre
// StdioServerTransport. Una identidad de agente real y verificada para
// stdio (Opcion B) es trabajo futuro, no de este commit.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPortalessMcpServer } from "./server.js";
import { createPageStore } from "../../atomic-elements/src/persistence/store-factory.js";
import { createPermissionStore } from "../../permissions/src/store-factory.js";
import { createPluginRegistryStore } from "../../plugin-sandbox/src/registry/store-factory.js";
import { InMemoryAuditLogStore } from "./audit/in-memory-audit-log-store.js";
import type { AgentIdentity } from "./permissions/types.js";

/**
 * Resuelve la identidad fija del agente para todo el proceso, desde
 * variables de entorno. MCP_AGENT_KEY es obligatoria -- sin ella, el
 * proceso no arranca, para no correr con una identidad vacia o
 * inventada. Ver limitacion completa en server.ts y AGENT.md.
 */
function resolveAgentIdentity(): AgentIdentity {
  const key = process.env.MCP_AGENT_KEY;
  if (!key) {
    throw new Error(
      "MCP_AGENT_KEY no esta definida. El servidor MCP de Portaless requiere una identidad de " +
      "agente fija (Opcion A, ver AGENT.md) -- defini MCP_AGENT_KEY (ej. 'ed25519:...' o cualquier " +
      "id estable) y opcionalmente MCP_AGENT_DISPLAY_NAME antes de arrancar este proceso."
    );
  }
  return {
    key,
    displayName: process.env.MCP_AGENT_DISPLAY_NAME ?? key,
  };
}

async function main(): Promise<void> {
  const agent = resolveAgentIdentity();

  const env = {
    DB: process.env.DB as any,
    PORTALESS_SQLITE_PATH: process.env.PORTALESS_SQLITE_PATH,
  };

  const pageStore = await createPageStore(env);
  const permissionStore = await createPermissionStore(env);
  // PluginRegistryStore ahora usa la misma factory D1/SQLite real que ya
  // usan functions/admin/permissions/index.js y
  // functions/admin/plugins/[pluginId]/vote.js -- antes se instanciaba
  // InMemoryPluginRegistryStore directo, lo que generaba un catalogo de
  // plugins distinto (y sin persistencia) entre lo que ve un agente via
  // MCP y lo que ve el panel admin. Sin D1 ni SQLite configurado, sigue
  // cayendo a memoria (fallback interno de la factory), ahora con seed
  // de plugins conocidos incluido.
  const pluginRegistry = await createPluginRegistryStore(env);
  const auditLog = new InMemoryAuditLogStore();
  // TODO(futuro): conectar UsageLedgerStore real de trust-layer
  // (packages/trust-layer/src/ledger/store-factory.ts, mismo patron
  // D1/SQLite) -- fuera de alcance de este commit de conexion inicial.
  const usageLedger: any = {
    get: async () => null,
    increment: async () => {},
  };

  const server = createPortalessMcpServer({
    pageStore,
    permissionStore,
    pluginRegistry,
    auditLog,
    usageLedger,
    agent,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[portaless-mcp-server] Error fatal al iniciar:", err);
  process.exit(1);
});
