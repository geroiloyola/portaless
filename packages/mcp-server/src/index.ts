#!/usr/bin/env node
// Entrypoint del servidor MCP de Portaless. Soporta dos transportes
// (elegidos por PORTALESS_MCP_TRANSPORT):
//
// - stdio (default): proceso hijo de un cliente MCP local (Claude
//   Desktop, Cursor, etc.). Identidad de agente Opcion A: fija desde
//   MCP_AGENT_KEY / MCP_AGENT_DISPLAY_NAME, resuelta una vez por
//   proceso -- el SDK de MCP no expone authInfo ni sesion por llamada
//   sobre StdioServerTransport, asi que esto NO es identidad por
//   invocacion (limitacion honesta, ver AGENT.md).
//
// - http (PORTALESS_MCP_TRANSPORT=http): servidor self-host stateless
//   en /mcp (ver http.ts). Identidad de agente Opcion B: cada peticion
//   porta un header "Authorization: Bearer <token>" emitido por el
//   operador desde /admin/api/mcp-agents; el token se verifica contra
//   McpAgentTokenStore EN CADA invocacion de tool (ver
//   permissions/agent-identity.ts). Dos tokens distintos son dos
//   identidades con permisos y auditoria separados.
//
// En ambos casos la verificacion de capacidades pasa por
// PermissionStore real (ver server.ts, principio rector).

import { createPortalessMcpServer } from "./server.js";
import type { McpStoreDeps } from "./server.js";
import { startMcpHttpServer, MCP_HTTP_PATH } from "./http.js";
import { createPageStore } from "../../atomic-elements/src/persistence/store-factory.js";
import { createElementPackStore } from "../../atomic-elements/src/persistence/element-pack-store-factory.js";
import { catalogFromStore } from "../../atomic-elements/src/persistence/element-pack-store.js";
import { createThemePackStore } from "../../atomic-elements/src/persistence/theme-pack-store-factory.js";
import { loadThemePacks } from "../../atomic-elements/src/persistence/theme-pack-store.js";
import { availableThemes, BUILTIN_THEMES } from "../../atomic-elements/src/themes/theme-pack.js";
import type { ThemePack } from "../../atomic-elements/src/themes/theme-pack.js";
import { elementRegistry, elementPalette } from "../../atomic-elements/src/elements/registry.js";
import { coreCatalog } from "../../atomic-elements/src/elements/element-pack.js";
import { createPermissionStore } from "../../permissions/src/store-factory.js";
import { createPluginRegistryStore } from "../../plugin-sandbox/src/registry/store-factory.js";
import { createUsageLedgerStore } from "../../trust-layer/src/ledger/store-factory.js";
import { InMemoryAuditLogStore } from "./audit/in-memory-audit-log-store.js";
import { createEnvAgentIdentityResolver } from "./permissions/agent-identity.js";

function isHttpTransport(): boolean {
  return process.env.PORTALESS_MCP_TRANSPORT === "http";
}

/** Transporte stdio -- Opcion A (identidad fija por proceso desde env). */
async function runStdioServer(deps: McpStoreDeps, resolveAgent: ReturnType<typeof createEnvAgentIdentityResolver>): Promise<void> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = createPortalessMcpServer({ ...deps, resolveAgent });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const httpTransport = isHttpTransport();
  // Opcion A: valida MCP_AGENT_KEY al arrancar (fail-fast ANTES de tocar
  // stores), no en la primera tool. En HTTP la identidad no viene de env.
  const resolveAgent = httpTransport ? null : createEnvAgentIdentityResolver();

  const env = {
    DB: process.env.DB as any,
    PORTALESS_SQLITE_PATH: process.env.PORTALESS_SQLITE_PATH,
  };

  const pageStore = await createPageStore(env);
  const permissionStore = await createPermissionStore(env);
  // PluginRegistryStore usa la misma factory D1/SQLite real que usan
  // functions/admin/permissions/index.js y functions/admin/plugins/
  // [pluginId]/vote.js. Sin D1 ni SQLite configurado cae a memoria
  // (fallback interno de la factory) con seed de plugins conocidos.
  const pluginRegistry = await createPluginRegistryStore(env);
  const auditLog = new InMemoryAuditLogStore();
  // UsageLedgerStore usa la factory real de trust-layer (D1 -> SQLite ->
  // memoria): el uso de las 7 tools MCP queda en el mismo ledger publico
  // que los requests HTTP normales via functions/_middleware.js
  // (GET /.well-known/portaless-usage-log.json, desde v0.0.9.3).
  const usageLedger = await createUsageLedgerStore(env);

  // Catalogo de elementos (core ∪ element packs) resuelto UNA vez y compartido
  // por todas las tools -- es lo que hace visible un pack instalado en
  // list_page_components y lo que valida el membership de tipos en
  // create_page/update_page/insert_block (v0.0.9.11). Best-effort: si la carga
  // de packs falla, se usa el core y los tipos de pack quedan rechazados --
  // nunca tira abajo el servidor. Ver element-catalog-plugins.md.
  let elementCatalog;
  try {
    const packStore = await createElementPackStore(env);
    elementCatalog = await catalogFromStore(packStore, elementRegistry, elementPalette);
  } catch {
    elementCatalog = coreCatalog(elementRegistry, elementPalette);
  }

  // Temas de pagina (v0.0.9.11): builtin ∪ instalados de theme_packs, con
  // los instalados sin poder ocultar un builtin (availableThemes). Mismo
  // patron best-effort que el catalogo: si la tabla no existe o falla la
  // carga, se sirven solo los builtins y apply_theme sigue funcionando.
  let themes: ThemePack[];
  try {
    const themeStore = await createThemePackStore(env);
    themes = availableThemes(await loadThemePacks(themeStore));
  } catch {
    themes = [...BUILTIN_THEMES];
  }

  const deps: McpStoreDeps = { pageStore, permissionStore, pluginRegistry, auditLog, usageLedger, elementCatalog, themes };

  if (httpTransport) {
    const port = Number(process.env.PORTALESS_MCP_HTTP_PORT ?? 8788);
    const host = process.env.PORTALESS_MCP_HTTP_HOST ?? "127.0.0.1";
    const running = await startMcpHttpServer({ ...deps, env, port, host });
    console.error(
      `[portaless-mcp-server] HTTP stateless escuchando en ${running.url} ` +
        `(identidad por invocacion via Authorization: Bearer -- tokens en /admin/api/mcp-agents)`
    );
  } else {
    await runStdioServer(deps, resolveAgent!);
  }
}

main().catch((err) => {
  console.error("[portaless-mcp-server] Error fatal al iniciar:", err);
  process.exit(1);
});
