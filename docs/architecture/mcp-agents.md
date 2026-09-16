# Agentes de IA vía MCP — Especificación

## Estado real

**NO IMPLEMENTADO.** `packages/mcp-server/` en este repositorio es un stub: contiene únicamente `README.md` y `package.json`, sin lógica de servidor MCP real. Este documento reemplaza la versión anterior (que solo constataba el estado "no implementado" y esbozaba el diseño previsto en el whitepaper) con una especificación completa, verificada contra el código real de los demás paquetes del monorepo.

## Por qué no se implementó todavía (razón original, se mantiene)

El roadmap del proyecto priorizó primero Atomic Elements (editor visual) y el sandboxing de plugins, porque un agente de IA necesita un esquema de salida validable —que ya existe gracias a Atomic Elements (`PageLayout`, `PageStore`)— antes de poder generar contenido de forma segura. Esta secuencia sigue siendo válida hoy: confirmamos que `packages/atomic-elements/src/persistence/store-factory.ts` ya expone `createPageStore` (interfaz `PageStore` con `load`/`save`/`list`, compartida con el editor cliente), lo cual significa que la dependencia que bloqueaba el mcp-server ya está resuelta. El siguiente cuello de botella no es el esquema de salida, sino el propio servidor MCP.

## Qué es y qué no es

Un MCP (Model Context Protocol) server expone **tools** — funciones con nombre, descripción y schema de entrada/salida definidos — que un agente de IA (Claude, GPT, Cursor) puede descubrir e invocar de forma estructurada, en vez de escribir código arbitrario o adivinar la forma de los datos internos.

El mcp-server de Portaless **no es una feature aislada de "crear páginas con IA"**. Es la interfaz única y auditable a través de la cual cualquier agente puede operar sobre Portaless, sin importar si la operación toca contenido, permisos, comercio, plugins o identidad. El monorepo ya tiene diez paquetes especializados (`apw-resolver`, `atomic-elements`, `auth`, `commerce-plugin`, `dashboard`, `identity-atproto`, `mcp-server`, `permissions`, `plugin-sandbox`, `trust-layer`); cada uno es una capa de capacidad que hoy un agente no puede tocar sin que un humano escriba código o JSON a mano.

## Principio rector: el humano define las reglas, el agente opera dentro de ellas

El mcp-server no debe ser un atajo que le dé a un agente más poder del que tendría un plugin humano. Debe forzar a cualquier agente, sin excepción, a pasar por las mismas capas de permisos que ya existen en Portaless:

- Toda tool que toque datos reales debe declarar qué `CapabilityId` necesita (vocabulario ya definido en `packages/plugin-sandbox/src/types.ts`: `content:read`, `content:write`, `media:read`, `media:write`, `email:send`, `commerce:read`, `commerce:checkout`, `storage:read`, `storage:write`, `agent:identify`, `site:admin`, `network:fetch`).
- Antes de ejecutar cualquier tool, el mcp-server debe consultar el `PermissionStore` real (`packages/permissions/src/permission-store.ts`). Si el agente no tiene la capacidad concedida, la tool falla explícitamente — igual que ya ocurre hoy en `node-isolated-vm.ts` con plugins.
- Cada agente se registra como `PermissionSubject` de tipo `"agent"`. Este tipo **ya existe y ya se usa**: confirmamos en `public/permissions/index.html` un registro real de ejemplo — `{ subject: { type: "agent", id: "ed25519:9f2a...c31b", displayName: "🤖 Agente ed25519:9f2a…c31b" }, capabilityId: "agent:identify", granted: true }`. El identificador es una clave pública Ed25519, no un nombre libre — la misma familia criptográfica que la verificación Web Bot Auth (RFC 9421) ya implementada en Portaless.

El mcp-server no introduce un sistema de permisos nuevo. Reutiliza el que ya existe, y su único trabajo adicional es forzar que ningún agente lo evada.

## Diseño previsto original (whitepaper) — confirmado y expandido

Estos cuatro puntos son del diseño original documentado en el whitepaper. Se mantienen íntegros y se conectan aquí con las piezas reales del repo:

- **Servidor MCP nativo con tools de lectura/propuesta de contenido**: agentes como Claude, GPT o Cursor deben poder leer y proponer cambios de contenido — ver tools concretas en la sección "Usos reales" más abajo.
- **Toda escritura de un agente se guarda como borrador, nunca se publica directo**: requiere aprobación humana explícita antes de cualquier cambio real. Este es el mecanismo de "aprobación humana obligatoria" descrito más abajo, y debería implementarse con el mismo flujo de pull request ya usado en este proyecto (ver PR #20 y #21).
- **Cuota de tokens configurable por sitio**: mecanismo de control de costo de uso de IA, con ruta ya prevista en el diseño original (`packages/mcp-server/src/permissions/`). Este control es distinto de los límites cuantitativos de capacidades (como topes de monto en `commerce:checkout`) — la cuota de tokens limita cuánto puede "pensar" o generar un agente, no qué puede tocar. Ambos mecanismos son necesarios y complementarios.
- **Registro de auditoría de cada acción del agente**: con ruta ya prevista (`packages/mcp-server/src/audit/`). Esto puede implementarse como una capa propia del mcp-server que además reenvíe cada evento al Trust Layer, de forma que exista tanto un registro detallado local (con capacidad de inspección rápida por sitio) como el ledger público ya existente vía `GET /.well-known/portaless-usage-log.json` (activo desde v0.0.9.3).

## Los seis usos reales, con detalle técnico

### 1. Creación y edición de páginas (el caso más obvio)

Publicar una página en Portaless significa crear un `PageLayout` válido en `src/content/pages/*.json`, con `slug` y `title` obligatorios y `description` opcional (usado en SEO/JSON-LD vía `SeoHead.astro` y `JsonLd.astro`), renderizado por `PageRenderer.astro`. Confirmamos que `createPageStore` (en `atomic-elements/src/persistence/store-factory.ts`) ya expone `load`/`save`/`list` sobre D1 o SQLite según entorno — el mcp-server debe consumir esta misma factory, no inventar una vía de persistencia paralela.

Tools propuestas: `list_page_components` (catálogo de bloques de Atomic Elements disponibles), `create_page` (genera un `PageLayout` como borrador, nunca publicación directa), `update_page` (lee con `PageStore.load`, modifica, guarda con `PageStore.save` solo tras aprobación), `preview_page` (renderiza en entorno de prueba). Requiere `content:write` para crear/editar y `content:read` para previsualizar.

### 2. Administración del sitio vía conversación

El Centro de Permisos (`packages/permissions`, UI conectada a D1/SQLite vía `functions/admin/permissions/index.js`, guard `canWrite(role)`) permite tools como `grant_capability`, `revoke_permission`, `list_installed_plugins`, `list_agent_permissions`. Conecta directamente con el catálogo dinámico de plugins con `trustScore` comunitario diseñado en el PR #21 — el mcp-server sería un segundo consumidor de ese registro. Requiere `site:admin`, la capacidad de mayor riesgo del catálogo.

### 3. Orquestar el sandbox de plugins

Con las 12 capacidades de `plugin-sandbox` ya con puente real en `isolated-vm` (verificado en `tests/e2e/sandbox-capability-bridges.test.ts`), una tool `run_plugin_capability` permitiría a un agente invocar cualquiera de ellas, pasando siempre por el mismo `CapabilityHostBridge` y `PermissionStore` que usan los plugins reales — sin bypass.

### 4. Consultar el Trust Layer como fuente de verdad

Una tool `query_usage_log` de solo lectura contra `GET /.well-known/portaless-usage-log.json` permite responder preguntas de auditoría sin que un humano revise el ledger manualmente. Bajo riesgo por ser de solo lectura sobre datos ya públicos.

### 5. Comercio conversacional

Tools como `create_product`, `check_order_status`, `update_price` sobre `commerce-plugin`, usando `commerce:read`/`commerce:checkout`. Mayor riesgo económico directo — debe ser de los últimos usos en habilitarse, con límites cuantitativos explícitos (tope por transacción, máximo de operaciones diarias).

### 6. Identidad y autenticación de agentes

`identity-atproto` y `auth` apuntan a que el mcp-server sea el punto donde un agente se autentica con un DID de AT Protocol antes de operar, quedando su identidad registrada en el Trust Layer. Ya hay evidencia de esta dirección: el subject tipo `"agent"` en el Centro de Permisos usa un identificador con forma de clave Ed25519. Depende de que `identity-atproto` deje de ser un stub — no bloquea los cinco usos anteriores.

## Mecanismos de control (cómo se traduce "reglas claras" en diseño concreto)

- **Permisos explícitos por agente, no globales**: cada agente es un `PermissionSubject` propio, con su propio conjunto de capacidades. Nunca hay un permiso todo-o-nada.
- **Aprobación humana obligatoria para escritura**: toda tool que escribe datos reales genera una propuesta (borrador o pull request), nunca ejecuta el cambio directo. Es el mecanismo ya previsto en el whitepaper original, aquí formalizado.
- **Cuota de tokens por sitio**: control de costo de uso de IA, independiente de los permisos de capacidad — limita cuánto puede generar un agente, no qué puede tocar.
- **Límites cuantitativos por capacidad**: topes de monto o de número de operaciones, como extensión del modelo `PermissionGrant` (`subject`, `capabilityId`, `granted`, `grantedAt`, `grantedBy`) con un campo opcional de restricciones.
- **Auditoría doble**: registro detallado propio del mcp-server (`packages/mcp-server/src/audit/`, según diseño original) más reenvío al ledger público del Trust Layer, para trazabilidad completa y verificable de cada acción de cada agente.

## Qué NO debe hacer el mcp-server

No debe tener una vía de acceso al filesystem, base de datos, o APIs de Cloudflare/Deno/Fastly distinta o más privilegiada que la de un plugin sandboxeado normal. Cualquier propuesta futura de que el mcp-server "se salte" el `PermissionStore` por conveniencia debe tratarse como una regresión de seguridad, no como una optimización.

## Estado actual y dependencias (verificado en el repo)

| Pieza necesaria | Estado real confirmado |
|---|---|
| `PermissionStore` con `PermissionSubject` tipo `"agent"` | El tipo ya existe y tiene un registro de ejemplo real en la UI del Centro de Permisos, identificado por clave Ed25519. Falta el flujo end-to-end de autenticación real. |
| `CapabilityHostBridge` con las 12 capacidades | Puente real completo, verificado en tests e2e. |
| Persistencia de páginas (`createPageStore`) | Confirmado y funcional, interfaz `PageStore` compartida con el editor cliente. Lista para ser consumida por el mcp-server sin cambios. |
| Trust Layer con lectura pública | Conectado desde v0.0.9.3. |
| Cuota de tokens (`packages/mcp-server/src/permissions/`) | Solo prevista en diseño original, no implementada. |
| Auditoría propia (`packages/mcp-server/src/audit/`) | Solo prevista en diseño original, no implementada. |
| `identity-atproto` para DIDs de agentes | Stub, sin implementar. |
| El propio `mcp-server` | Stub (solo `README.md` y `package.json`), sin implementar — este documento es su especificación. |

## Próximo paso recomendado

Con `createPageStore` y el subject tipo `"agent"` ya confirmados como piezas reales, el camino de menor riesgo es implementar primero una tool de solo lectura (`query_usage_log` o `list_installed_plugins`) para validar el patrón de conexión del mcp-server al `PermissionStore` sin tocar ninguna escritura todavía. `create_page` sería el siguiente paso natural, apoyado directamente en `PageStore`, ya validado por el propio roadmap original como la razón de por qué se priorizó Atomic Elements antes que el mcp-server.
