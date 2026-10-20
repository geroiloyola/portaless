# Agentes de IA vía MCP — Especificación

> **Documento de diseño histórico.** Narra la construcción inicial del MCP
> server (los 6 commits originales). El **estado actual** vive en
> [`AGENT.md`](../../AGENT.md) y en el código: `packages/mcp-server/src/server.ts`
> es la fuente de verdad del número de tools, y hoy son **12**, no 7 — la tabla
> de abajo se conserva como historia, no como inventario vigente. El conteo está
> fijado por `tests/unit/mcp-tool-count.test.ts`, que falla si un doc publica
> otro número.

## Estado real

**IMPLEMENTADO end-to-end.** `packages/mcp-server/` deja de ser un stub desde el plan de 6 commits documentado en este archivo (commits `b64705b3` a `05078aa2`, mas 3 fixes posteriores). Tiene servidor base (`server.ts`), capa de permisos (`permissions/`), capa de auditoria doble (`audit/`), y **12 tools reales** registradas sobre `McpServer` del SDK oficial: `query_usage_log`, `list_page_components`, `list_themes`, `list_installed_plugins`, `create_page`, `update_page`, `insert_block`, `update_block`, `delete_block`, `apply_theme`, `grant_capability`, `revoke_permission`.

Este documento reemplaza la version anterior (que describia el paquete como "unicamente README.md y package.json, sin logica de servidor MCP real") con el estado verificado del codigo real, confirmado archivo por archivo esta sesion.

## Por qué se implementó en este orden (razón original, confirmada en la práctica)

El roadmap del proyecto priorizó primero Atomic Elements (editor visual) y el sandboxing de plugins, porque un agente de IA necesita un esquema de salida validable antes de poder generar contenido de forma segura. Esa secuencia se cumplió: `create_page`/`update_page` (commit 5/6) se apoyan directamente en `createPageStore` (interfaz `PageStore` con `load`/`save`/`list`, compartida con el editor cliente y con `src/pages/admin/editor.astro`), sin ninguna vía de persistencia paralela.

## Qué es y qué no es

Un MCP (Model Context Protocol) server expone **tools** — funciones con nombre, descripción y schema de entrada/salida definidos — que un agente de IA (Claude, GPT, Cursor) puede descubrir e invocar de forma estructurada, en vez de escribir código arbitrario o adivinar la forma de los datos internos.

El mcp-server de Portaless **no es una feature aislada de "crear páginas con IA"**. Es la interfaz única y auditable a través de la cual cualquier agente puede operar sobre Portaless, tocando contenido, permisos, o el catálogo de plugins — hoy ya con código real conectado a cada una de esas capas, no solo como diseño previsto.

## Principio rector: el humano define las reglas, el agente opera dentro de ellas

El mcp-server no es un atajo que le da a un agente más poder del que tendría un plugin humano. Fuerza a cualquier agente, sin excepción, a pasar por las mismas capas de permisos que ya existen en Portaless — esto ya está implementado, no es solo un principio de diseño:

- Cada tool que toca datos reales declara su `CapabilityId` (vocabulario de `packages/plugin-sandbox/src/types.ts`) y llama a `requireCapability()` antes de ejecutar nada. Confirmado en `create-page.ts`, `update-page.ts`, `grant-capability.ts`, `revoke-permission.ts`.
- `requireCapability()` consulta el `PermissionStore` real (`packages/permissions/src/permission-store.ts`, resuelto vía `createPermissionStore(env)` en `index.ts`). Si el agente no tiene la capacidad concedida, la tool falla explícitamente — igual que ya ocurre con plugins en `node-isolated-vm.ts`.
- Las tools de solo lectura (`list_page_components`, `query_usage_log`, `list_installed_plugins`) se ejecutan sin chequeo de capacidad porque exponen catálogo o ledger ya públicos — decisión explícita documentada en el propio commit de `query-usage-log.ts`, no un descuido.
- Cada agente se identifica con un `AgentIdentity` (`key`, `displayName`), resuelto en `index.ts` desde `MCP_AGENT_KEY` (variable de entorno obligatoria — el proceso no arranca sin ella).

El mcp-server no introduce un sistema de permisos nuevo. Reutiliza el que ya existía, y su trabajo es forzar que ningún agente lo evada.

## Las tools reales, con estado de implementación

Las 7 primeras son las del diseño inicial (con su commit). Las 5 siguientes se
sumaron después; `server.ts` es la fuente de verdad y hoy el total es **12**.

| Tool | Capacidad requerida | Backend real | Commit |
|---|---|---|---|
| `query_usage_log` | Ninguna (ledger ya público) | `UsageLedgerStore` real de trust-layer | `b64705b3` |
| `list_page_components` | Ninguna (catálogo informativo) | `ELEMENT_TYPES` — sincronizado con `elementPalette`, incluye los 4 tipos de link-en-bio | `de874b84` |
| `create_page` | `content:write` | `PageStore.save()` real, siempre guarda como borrador; no expone un flag para publicar | `da599e3e` (fix de los 4 ElementType nuevos) |
| `update_page` | `content:write` / `content:read` | Lee y guarda drafts; rechaza status published y cambios a páginas publicadas/private | — |
| `grant_capability` | `site:admin` | `PermissionStore.setGrant()` real | `05078aa2` |
| `revoke_permission` | `site:admin` | `PermissionStore.setGrant()` real (revocación) | `05078aa2` |
| `list_installed_plugins` | Ninguna (catálogo informativo) | `PluginRegistryStore` real, expone `trustScore`/`trustScoreVotes`/`sourceType` | `05078aa2` |
| `insert_block` | `content:write` | muta un nodo draft por `nodeId` (o padre + índice + slot); rechaza páginas publicadas/private | — |
| `update_block` | `content:write` | ídem, actualización de un nodo draft | — |
| `delete_block` | `content:write` | ídem, borrado de un nodo draft | — |
| `apply_theme` | `content:write` | aplica un theme pack a la página | — |
| `list_themes` | Ninguna (catálogo informativo) | catálogo de theme packs disponibles | — |

### C06: frontera entre edición y publicación

Las tools MCP no son una ruta de publicación. `create_page` siempre crea
`status: "draft"`; `update_page` solo acepta mantener/poner un draft y rechaza
un `status: "published"`; las tools de bloques rechazan mutar un layout
publicado. Un admin autenticado promueve o privatiza desde `/admin/pages`.
`content:read` de plugins/MCP solo devuelve páginas publicables; no es una
capacidad para leer drafts, páginas privadas ni `.airchive/`. Un plugin con
`content:write` solo puede guardar layouts draft nuevos y no puede sobrescribir
una página publicada/private. La política de publicación compartida es
`packages/deploy-engine/src/draft-filter.ts::isPubliclyPublishable()`.

Esto es una barrera fail-closed, no un sistema de revisiones: MCP todavía no
puede proponer una revisión de una URL ya publicada manteniendo visible el
contenido anterior. Ese flujo espera el modelo de revisiones/aprobaciones del
MVP; hasta entonces, la edición de contenido publicado se hace desde el panel.

**Nota de riesgo explícita, ya documentada en el propio código**: `grant_capability`/`revoke_permission` requieren `site:admin`, la capacidad de mayor riesgo del catálogo — un agente con `site:admin` puede conceder o revocar permisos a otros subjects, incluido él mismo. Es la tool que debería tener más fricción en la práctica, según el comentario inline de `grant-capability.ts`.

## Mecanismo de control ya implementado: auditoría doble

Cada invocación de tool pasa por `recordToolInvocation()`, que registra el evento en dos lugares:

1. **Auditoría local** (`AuditLogStore`, hoy `InMemoryAuditLogStore` en `index.ts` — sin factory D1/SQLite propia todavía, ver "Pendiente" más abajo).
2. **Ledger público del Trust Layer** (`UsageLedgerStore` real, vía `createUsageLedgerStore(env)`), el mismo que expone `GET /.well-known/portaless-usage-log.json` para requests HTTP normales desde v0.0.9.3.

Esto significa que el uso de las tools por parte de cualquier agente ya queda registrado en el mismo ledger auditable públicamente que usa el resto de Portaless — no un log aislado sin trazabilidad externa.

## Qué NO debe hacer el mcp-server (se mantiene, ya verificado en el código)

No tiene una vía de acceso al filesystem, base de datos, o APIs de Cloudflare/Deno/Fastly distinta o más privilegiada que la de un plugin sandboxeado normal. Confirmado: cada store que usa el mcp-server (`PageStore`, `PermissionStore`, `PluginRegistryStore`, `UsageLedgerStore`) es la misma factory D1/SQLite/memoria que usan los endpoints HTTP del panel admin — no hay una vía paralela.

## Identidad de agente: por invocación sobre HTTP (Opción B), fija por proceso sobre stdio (Opción A)

El servidor soporta dos transportes (elegidos por `PORTALESS_MCP_TRANSPORT`), y con ellos dos modos de identidad. Ambos resuelven la identidad mediante `resolveAgent()` ejecutado en **cada** invocación de tool (`packages/mcp-server/src/permissions/agent-identity.ts`) y verifican capacidades contra el mismo `PermissionStore` real.

### Opción B (implementada): identidad por invocación sobre HTTP

`PORTALESS_MCP_TRANSPORT=http` levanta un servidor self-host con `StreamableHTTPServerTransport` stateless en `/mcp` (default `127.0.0.1:8788`, configurable con `PORTALESS_MCP_HTTP_PORT`/`PORTALESS_MCP_HTTP_HOST`). Cada petición porta el header `Authorization: Bearer <token>`; el token crudo viaja como `authInfo` hasta el handler de cada tool, que lo verifica contra `McpAgentTokenStore` **por invocación** (`createBearerTokenAgentIdentityResolver`). Solo el hash sha256 del token se persiste (tabla `mcp_agent_tokens`, patrón idéntico a `authorized_escrow_providers.api_key_hash`); el plaintext se emite **una sola vez** desde `POST /admin/api/mcp-agents` (rol admin; `GET` lista, `PATCH` revoca) y la emisión rota — un solo token activo por `agentKeyId`. Dos tokens distintos son dos identidades con permisos y auditoría separados; revocar un token corta ese acceso sin reiniciar nada.

Honestidad sobre el mecanismo: es un bearer token (secreto simétrico), **no** una verificación criptográfica tipo Web Bot Auth (firma Ed25519 por request) — esa diferencia se mantiene documentada.

### Opción A (única posible sobre stdio): identidad fija por proceso

El cliente stdio local (Claude Desktop, Cursor) no envía headers por invocación — el SDK de MCP no expone `authInfo` sobre `StdioServerTransport`. Sobre stdio, `MCP_AGENT_KEY` (obligatoria) / `MCP_AGENT_DISPLAY_NAME` definen una identidad fija por proceso (`createEnvAgentIdentityResolver`, fail-fast al arrancar). El riesgo conocido de siempre se mantiene: todo el proceso stdio actúa como un único agente, sin verificación por llamada. Para identidad real por invocación, usar el transporte HTTP.

## Estado actual y dependencias (verificado en el código real, esta sesión)

| Pieza necesaria | Estado real confirmado |
|---|---|
| `PermissionStore` con `PermissionSubject` tipo `"agent"` | Conectado end-to-end. `grant_capability`/`revoke_permission` escriben directo sobre `PermissionStore.setGrant()` real. |
| `CapabilityHostBridge` con las 12 capacidades | Puente real completo, sin cambios respecto a versiones anteriores. |
| Persistencia de páginas (`createPageStore`) | Conectado. `create_page`/`update_page` lo consumen directo, mismo store que `src/pages/admin/editor.astro`. |
| `PluginRegistryStore` con factory D1/SQLite propia | Conectado. `index.ts` usa `createPluginRegistryStore(env)`, no memoria fija. |
| `UsageLedgerStore` con factory real | Conectado. `index.ts` usa `createUsageLedgerStore(env)`, no un stub get/increment. |
| Auditoría doble (local + ledger público) | Conectada vía `recordToolInvocation()` en cada tool. |
| Auditoría local (`AuditLogStore`) con factory D1/SQLite propia | **Pendiente** — hoy solo `InMemoryAuditLogStore`, se resetea entre procesos. |
| Identidad de agente por invocación (Opción B) | **Implementada para transporte HTTP**: bearer token verificado por invocación (`mcp_agent_tokens`, emitido/revocado desde `/admin/api/mcp-agents`). Sobre stdio se mantiene Opción A (identidad fija por proceso) — limitación del SDK, no de este repo. |
| `identity-atproto` para DIDs de agentes | El paquete ya no es stub (v0.0.9.10: resolucion de handles AT + puente de reputacion APW), pero los DIDs de agentes MCP **no** se resuelven via AT: la identidad de agente sigue siendo token/entorno — no bloquea las tools ya activas. |
| `packages/mcp-server/src/permissions/` | Lógica real: guard central `requireCapability()`/`withCapability()`, resolvers de identidad (`agent-identity.ts`) y store de tokens de agentes (`agent-token-store.ts`, D1/SQLite/memoria). No existe lógica de cuota de tokens (nunca la hubo — la fila previa lo decía como "pendiente de verificación"). |

## Próximo paso recomendado

El trabajo pendiente de mayor impacto es una factory D1/SQLite propia para `AuditLogStore` (hoy en memoria, se resetea entre procesos) — mismo patrón ya aplicado a los otros 4 stores del mcp-server. Sobre identidad, los caminos naturales de evolución son: una UI en el Centro de Permisos para emitir/rotar/revocar tokens de agentes (hoy solo endpoint admin), y reemplazar el bearer token simétrico por verificación criptográfica por request estilo Web Bot Auth (firma Ed25519), cuando el ecosistema MCP cliente permita firmar cada llamada.
