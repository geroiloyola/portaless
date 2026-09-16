#!/usr/bin/env node
// Entrypoint del servidor MCP de Portaless. Corre sobre stdio, pensado
// para ser lanzado como proceso hijo por un cliente MCP (Claude Desktop,
// Cursor, etc.), siguiendo el patron estandar del SDK oficial.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPortalessMcpServer } from "./server.js";

async function main(): Promise<void> {
  const server = createPortalessMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[portaless-mcp-server] fallo fatal al iniciar:", err);
  process.exit(1);
});
