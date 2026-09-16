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

En desarrollo activo. Commit 1/6: andamiaje base del servidor (sin tools
todavia). Los siguientes commits agregan: capa de permisos, capa de
auditoria, tool de solo lectura del Trust Layer, tools de contenido
(Atomic Elements), y tools de administracion (Centro de Permisos).

## Desarrollo

```bash
npm install
npm run dev   # corre src/index.ts directamente con tsx
npm run build # compila a dist/
```
