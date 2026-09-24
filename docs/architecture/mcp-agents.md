# Agentes de IA vía MCP — Especificación

## Estado real

**IMPLEMENTADO end-to-end.** `packages/mcp-server/` deja de ser un stub desde el plan de 6 commits documentado en este archivo (commits `b64705b3` a `05078aa2`, mas 3 fixes posteriores). Tiene servidor base (`server.ts`), capa de permisos (`permissions/`), capa de auditoria doble (`audit/`), y **7 tools reales** registradas sobre `McpServer` del SDK oficial: `query_usage_log`, `list_page_components`, `create_page`, `update_page`, `grant_capability`, `revoke_permission`, `list_installed_plugins`.

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

## Las 7 tools reales, con estado de implementación

| Tool | Capacidad requerida | Backend real | Commit |
|---|---|---|---|
| `query_usage_log` | Ninguna (ledger ya público) | `UsageLedgerStore` real de trust-layer | `b64705b3` |
| `list_page_components` | Ninguna (catálogo informativo) | `ELEMENT_TYPES` — sincronizado manualmente con `elementPalette`, incluye los 4 tipos de link-en-bio | `de874b84` |
| `create_page` | `content:write` | `PageStore.save()` real, guarda como borrador | `da599e3e` (fix de los 4 ElementType nuevos) |
| `update_page` | `content:write` / `content:read` | `PageStore.load()` + `PageStore.save()` reales | — |
| `grant_capability` | `site:admin` | `PermissionStore.setGrant()` real | `05078aa2` |
| `revoke_permission` | `site:admin` | `PermissionStore.setGrant()` real (revocación) | `05078aa2` |
| `list_installed_plugins` | Ninguna (catálogo informativo) | `PluginRegistryStore` real, expone `trustScore`/`trustScoreVotes`/`sourceType` | `05078aa2` |

**Nota de riesgo explícita, ya documentada en el propio código**: `grant_capability`/`revoke_permission` requieren `site:admin`, la capacidad de mayor riesgo del catálogo — un agente con `site:admin` puede conceder o revocar permisos a otros subjects, incluido él mismo. Es la tool que debería tener más fricción en la práctica, según el comentario inline de `grant-capability.ts`.

## Mecanismo de control ya implementado: auditoría doble

Cada invocación de tool pasa por `recordToolInvocation()`, que registra el evento en dos lugares:

1. **Auditoría local** (`AuditLogStore`, hoy `InMemoryAuditLogStore` en `index.ts` — sin factory D1/SQLite propia todavía, ver "Pendiente" más abajo).
2. **Ledger público del Trust Layer** (`UsageLedgerStore` real, vía `createUsageLedgerStore(env)`), el mismo que expone `GET /.well-known/portaless-usage-log.json` para requests HTTP normales desde v0.0.9.3.

Esto significa que el uso de las 7 tools por parte de cualquier agente ya queda registrado en el mismo ledger auditable públicamente que usa el resto de Portaless — no un log aislado sin trazabilidad externa.

## Qué NO debe hacer el mcp-server (se mantiene, ya verificado en el código)

No tiene una vía de acceso al filesystem, base de datos, o APIs de Cloudflare/Deno/Fastly distinta o más privilegiada que la de un plugin sandboxeado normal. Confirmado: cada store que usa el mcp-server (`PageStore`, `PermissionStore`, `PluginRegistryStore`, `UsageLedgerStore`) es la misma factory D1/SQLite/memoria que usan los endpoints HTTP del panel admin — no hay una vía paralela.

## Limitación real y activa: identidad de agente fija por proceso (Opción A)

El SDK de MCP no expone hoy un mecanismo de sesión por invocación sobre `StdioServerTransport`. `AgentIdentity` se resuelve **una sola vez** al arrancar el proceso (`MCP_AGENT_KEY`/`MCP_AGENT_DISPLAY_NAME`), no por cada llamada — todo el proceso stdio actúa como un único agente fijo, sin verificación criptográfica real por invocación, a diferencia de Web Bot Auth (que sí verifica firma Ed25519 por request HTTP).

Esto es una limitación de seguridad activa, documentada en `AGENT.md` y en el propio comentario inline de `server.ts` y `index.ts` — no un detalle menor. Una identidad de agente real y verificada por invocación sobre stdio (Opción B) queda fuera de alcance hasta que el SDK de MCP lo soporte, o hasta que se evalúe un transporte alternativo.

## Estado actual y dependencias (verificado en el código real, esta sesión)

| Pieza necesaria | Estado real confirmado |
|---|---|
| `PermissionStore` con `PermissionSubject` tipo `"agent"` | Conectado end-to-end. `grant_capability`/`revoke_permission` escriben directo sobre `PermissionStore.setGrant()` real. |
| `CapabilityHostBridge` con las 12 capacidades | Puente real completo, sin cambios respecto a versiones anteriores. |
| Persistencia de páginas (`createPageStore`) | Conectado. `create_page`/`update_page` lo consumen directo, mismo store que `src/pages/admin/editor.astro`. |
| `PluginRegistryStore` con factory D1/SQLite propia | Conectado. `index.ts` usa `createPluginRegistryStore(env)`, no memoria fija. |
| `UsageLedgerStore` con factory real | Conectado. `index.ts` usa `createUsageLedgerStore(env)`, no un stub get/increment. |
| Auditoría doble (local + ledger público) | Conectada vía `recordToolInvocation()` en las 7 tools. |
| Auditoría local (`AuditLogStore`) con factory D1/SQLite propia | **Pendiente** — hoy solo `InMemoryAuditLogStore`, se resetea entre procesos. |
| Identidad de agente por invocación (Opción B) | **Pendiente**, bloqueada por el SDK de MCP (ver limitación arriba). |
| `identity-atproto` para DIDs de agentes | Stub, sin implementar — no bloquea las 7 tools ya activas. |
| Cuota de tokens por sitio (`packages/mcp-server/src/permissions/`) | Directorio existe; confirmar si tiene lógica real o solo la estructura prevista — pendiente de verificación en una sesión futura. |

## Próximo paso recomendado

Con las 7 tools ya conectadas a stores reales, el trabajo pendiente de mayor impacto es una factory D1/SQLite propia para `AuditLogStore` (hoy en memoria, se resetea entre procesos) — mismo patrón ya aplicado a los otros 4 stores del mcp-server. La Opción B de identidad por invocación queda bloqueada por el SDK externo, no por trabajo pendiente de este repositorio.
