# @portaless/mcp-server

Servidor MCP (Model Context Protocol) nativo de Portaless. Expone tools
para que agentes de IA (Claude, GPT, Cursor, u otro cliente compatible
con MCP) puedan operar sobre un sitio Portaless -- contenido, permisos,
plugins, comercio -- siempre a traves de las mismas capas de permisos
que ya gobiernan a los plugins humanos.

Ver la especificacion completa, el principio rector de permisos, y el
orden de desarrollo por commits en
[`docs/architecture/mcp-agents.md`](../../docs/architecture/mcp-agents.md).

## Estado

Activo. El servidor registra 19 tools MCP: contenido, contexto acotado y
flujo de propuestas/aprobación por revisión exacta. La auditoría por evento
usa D1/SQLite append-only; el detalle y las decisiones de permisos están en
[`docs/architecture/mcp-agents.md`](../../docs/architecture/mcp-agents.md).

## Desarrollo

```bash
npm install
PORTALESS_SQLITE_PATH=./portaless.db MCP_AGENT_KEY=local-dev npm run dev # stores durables + identidad stdio
npm run build # compila a dist/
```

El servidor no arranca con auditoría volátil: configura `DB` (D1) o
`PORTALESS_SQLITE_PATH`. En HTTP, configura además las variables de identidad
por bearer y el allowlist de hosts cuando escuches fuera de loopback.
