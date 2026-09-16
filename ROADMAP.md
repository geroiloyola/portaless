# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [~] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5, mergeado) creo D1PermissionStore/SqlitePermissionStore y sus equivalentes de ledger, pero NINGUN endpoint los invocaba realmente (el store existia, nada lo llamaba) -- esta linea se marco [x] de forma prematura en v0.0.6. Corregido parcialmente en v0.0.9.2: ver linea de Centro de Permisos en Prioridad media, ahora si conectado end-to-end. El Trust Layer / ledger sigue exactamente en el mismo estado que en v0.0.6 (store implementado, cero endpoints que lo usen) -- queda pendiente, ver esa linea separada abajo.
- [x] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5, mergeado)
- [x] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5, mergeado)

## Prioridad media
- [x] SEO/GEO nativo -- v0.0.8: imports de JsonLd + SeoHead conectados en src/pages/paginas/[slug].astro, usando los helpers de src/lib/seo.ts (getSiteUrl, buildCanonicalUrl). Ver docs/architecture/seo-geo.md.
- [x] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519) - mergeado
- [x] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements - mergeado
- [x] Migrar src/commerce/ a un plugin sandboxeado real - mergeado
- [~] canWrite(role) aplicado a todo el dashboard -- guard DOM-level mergeado; validacion server-side confirmada en el unico endpoint de escritura del dashboard identificado en el repo (functions/admin/pages/[slug].js, v0.0.8). No se encontraron otros endpoints de escritura bajo functions/admin/ al momento de este PR -- si se agregan nuevos endpoints de escritura a futuro, deben replicar este mismo patron de canWrite(role) server-side. PENDIENTE CRITICO: no se pudo confirmar en este PR si functions/admin/_middleware.js expone context.data.user (bloqueo de herramienta, ver .airchive/project_memory/lessons_learned.md) -- verificar manualmente antes de considerar esta linea totalmente cerrada. Ver docs/architecture/server-side-role-checks.md.
- [x] Test end-to-end del sandbox de plugins corriendo en CI
- [x] Conectar la persistencia real (PageStore) dentro de functions/admin/pages/[slug].js -- v0.0.8: se agregaron implementaciones server-side D1PageStore y SqlitePageStore en packages/atomic-elements/src/persistence/stores/, mas store-factory.ts, todas cumpliendo la interfaz PageStore ya existente (load/save/list) para mantener compatibilidad con LocalStoragePageStore del editor cliente. Mismo patron que packages/permissions y packages/trust-layer/src/ledger. GET y PUT ya usan createPageStore(env) en vez de placeholders.
- [~] Puentes de capacidades restantes en isolated-vm -- v0.0.9: 9 capacidades nuevas (storage:read/write, email:send, commerce:read/checkout, media:read/write, agent:identify, site:admin) ya cruzan al isolate via `ivm.Reference.apply({result:{promise:true}})`, sumadas a network:fetch (ya existia) = 10/12 con puente real. Quedan `content:read`/`content:write` sin puente funcional -- solo tienen el guard de denegacion, nunca se registro la funcion positiva cuando la capacidad SI esta concedida (ver packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md, seccion Pendiente). Se corrige el conteo previo de este roadmap ("solo 3 de 12 tienen puente"): en realidad solo network:fetch tenia un bridge funcional antes de este PR. Ademas, se descubrio y corrigio en el camino un bug real de la libreria `isolated-vm` (no de Portaless) que rompia CUALQUIER callback host async awaited dentro del isolate con `TypeError: #<Promise> could not be cloned.` -- ver comentario extenso al inicio de packages/plugin-sandbox/src/adapters/node-isolated-vm.ts y issues linkeados (laverdet/isolated-vm #240, #125, #234, #294). Verificado con tests/e2e/sandbox-capability-bridges.test.ts.
- [~] Integracion real Cloudflare Workers for Platforms / Deno Deploy -- v0.0.9.1: implementada la llamada real a las APIs REST publicas de ambos proveedores (subida/creacion + invocacion), siguiendo el plan de 5 puntos documentado en el PR anterior. **NO verificado end-to-end contra una cuenta real** (sin credenciales de prueba disponibles al momento de este PR) -- la logica de construccion de requests, mapeo de capacidades y parsing de respuestas esta cubierta por tests con `fetch` mockeado (tests/e2e/sandbox-deno-deploy-adapter.test.ts, tests/e2e/sandbox-cloudflare-adapter.test.ts), pero el primer uso real contra cada API debe tratarse como una integracion nueva sin confirmar. Detalles:
  - **Deno Deploy**: mapeo directo (`network:fetch` -> allowlist de host aplicado en el bootstrap subido; capacidades no-red -> bridge HTTP hacia `SandboxExecutionInput.bridgeUrl`, nuevo campo del contrato). Crea una deployment nueva por `execute()` -- limpieza/reuso de deployments viejas queda pendiente (ver nota en el propio archivo).
  - **Cloudflare Workers for Platforms**: sube/actualiza el script via PUT (scriptName deterministico por `name@version`, reusa en vez de acumular). **Requiere infraestructura externa a este adaptador**: un Worker "dispatcher" fijo desplegado por namespace (no lo despliega este codigo) que resuelve `env.DISPATCH_NAMESPACE.get(scriptName)` -- sin `dispatcherUrl` configurado, el adaptador puede subir scripts pero falla explicitamente al intentar invocarlos. El filtrado autoritativo de red via "outbound worker" tampoco lo configura este adaptador (ver comentario extenso al inicio de cloudflare-workers-for-platforms.ts).
  - **Fastly Compute**: SIN cambios en este PR, sigue solo con TODOs documentados (decision explicita: requiere un plugin ya compilado a Wasm para poder probarse, no disponible).
  - Se agrego `bridgeUrl?: string` a `SandboxExecutionInput` (packages/plugin-sandbox/src/types.ts) -- URL de un endpoint HTTP interno de Portaless que expone `CapabilityHostBridge` para adaptadores que ejecutan el plugin fuera de este proceso Node; queda como responsabilidad de un futuro PR implementar ese endpoint interno real (hoy ningun handler HTTP de Portaless lo expone todavia).
- [x] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce -- v0.0.9, ver tests/unit/webbotauth-verify.test.ts (cache evita refetch en la segunda request al mismo operador; un nonce reusado en un replay exacto es rechazado).
- [x] Pool de isolates reutilizables para el commerce-plugin -- v0.0.9, `poolMaxIsolates` en NodeIsolatedVmAdapter, con aislamiento real de Context por ejecucion aunque el isolate subyacente se reutilice. Ver tests/e2e/sandbox-isolate-pool.test.ts.
- [x] Reordenamiento por arrastre dentro de un mismo slot de columnas -- v0.0.9: `makeDraggable` ahora tambien se aplica a los bloques ya renderizados en el canvas (no solo a los items de la paleta), con payload `{kind: "move-element", nodeId}`; la logica de mover/reordenar se extrajo a packages/atomic-elements/src/editor/tree-ops.ts (funciones puras, testeadas sin DOM en tests/e2e/atomic-elements-drag-drop-reorder.test.ts) para cubrir reordenamiento dentro del mismo contenedor, movimiento entre columnSlots distintos, y proteccion contra soltar un nodo dentro de su propio subarbol.

- [x] Centro de Permisos conectado a persistencia real end-to-end -- v0.0.9.2: nuevo endpoint `functions/admin/permissions/index.js` (GET snapshot con seed de subjects conocidos + defaults no concedidos, PUT otorga/revoca con guard server-side `canWrite(role)==="admin"`, mismo patron que `functions/admin/pages/[slug].js`), UI (`permission-center-ui.ts`) reescrita para que el unico camino de escritura sea `onToggle` (antes llamaba a `store.setGrant()` directo Y a `onToggle`, lo cual no tenia sentido porque D1/SQLite son server-side-only), nueva pagina `src/pages/admin/permissions.astro` con estados de carga/guardado/error. 9 tests nuevos en `tests/unit/admin-permissions-role-check.test.ts` (401/403/400/happy-path GET+PUT). Limitacion conocida: el catalogo de subjects (`hello-plugin`, `commerce-plugin`) esta hardcodeado en el endpoint, no viene de un registro dinamico de plugins instalados (no existe todavia). Ver `packages/permissions/docs/PERMISSIONS_CENTER.md`.
- [ ] Trust Layer / ledger conectado a persistencia real end-to-end -- sigue exactamente en el mismo estado que v0.0.6: `createUsageLedgerStore()` existe con D1/SQLite reales (`packages/trust-layer/src/ledger/`), pero ningun endpoint HTTP del repo lo invoca. Explicitamente fuera de alcance en v0.0.9.2 (decision del usuario: esta ronda fue solo Centro de Permisos). Replicar el mismo patron que `functions/admin/permissions/index.js` cuando se aborde.
- [ ] Bug de nombre de binding D1 inconsistente entre factories -- encontrado durante v0.0.9.2, no corregido (fuera de alcance de esa tarea). `packages/atomic-elements/src/persistence/store-factory.ts` (`createPageStore`, ya en produccion via PR #6/#7/#8) lee `env.PORTALESS_DB`, mientras que `wrangler.toml`, `packages/auth/src/store-factory.ts`, `packages/permissions/src/store-factory.ts` y `packages/trust-layer/src/ledger/store-factory.ts` leen `env.DB`. Con el binding `DB` documentado en `wrangler.toml`, `PageStore` nunca veria D1 real en Cloudflare Pages y caeria siempre a SQLite. Requiere decidir un nombre unico y alinear las 2 factories (probablemente renombrar `PageStoreEnv.PORTALESS_DB` a `DB` para consistencia, pero verificar si algun despliegue real ya depende del nombre actual antes de cambiarlo).

## Baja prioridad
- [ ] Cobro real Pay per Crawl
- [ ] MCP nativo
- [ ] Identidad AT Protocol
- [ ] Protocol APW resolver real
- [ ] Agente raiz de lenguaje natural
- [ ] Recuperacion contrasena, 2FA, OAuth/SSO
- [ ] Automatizar admin inicial en D1
- [ ] Comando unico schema.sql

## Vision largo plazo
- [ ] Lenguaje de programacion de intencion humana

## Pull Requests
| PR | Rama | Estado | Contenido |
|---|---|---|---|
| #1 | chore/github-workflows | Mergeado | gitignore, workflows |
| #2 | docs/roadmap | Mergeado | ROADMAP inicial |
| #3 | agentic | Mergeado | AGENT.md |
| #4 | agentic | Mergeado | auth + persistencia |
| #5 | agentic | Mergeado | v0.0.6 + v0.0.7 |
| #6 | feature/v0.0.8-seo-canwrite-pagestore -> agentic | Mergeado | SEO imports conectados, PageStore real (D1/SQLite server-side), confirmacion de alcance de canWrite server-side |
| #7 | agentic -> main | Mergeado | v0.0.8: SEO conectado, PageStore real, checklist del PR #6 resuelto |
| #8 | feature/v0.0.9-capabilities-nonce-pool-dnd -> agentic | Mergeado | Puentes de capacidades (10/12, faltan content:read/write), cache+nonce Web Bot Auth, pool de isolates, drag-and-drop reorder; TODOs documentados para Cloudflare/Deno/Fastly (sin implementar) |
| #9 | agentic -> main | Mergeado | v0.0.9: promueve el contenido del PR #8 a main |
| #10 | feature/v0.0.9.1-cloudflare-deno-real-integration -> agentic | Este PR (borrador) | Integracion real Cloudflare Workers for Platforms + Deno Deploy (sin verificar contra cuenta real); Fastly sin cambios |

## Tareas manuales pendientes

1. Verificar manualmente que functions/admin/_middleware.js expone context.data.user antes de confiar en canWrite(role) server-side en produccion -- no se pudo leer su contenido en ninguna sesion de trabajo por un bug del conector de GitHub (ver lessons_learned.md).
2. Si se agregan nuevos endpoints de escritura al dashboard (permisos, configuracion, etc.), replicar el patron de canWrite(role) de functions/admin/pages/[slug].js.
3. Confirmar los nombres exactos de los campos title/description en packages/atomic-elements/src/types.ts (PageLayout) -- src/pages/paginas/[slug].astro los usa de forma defensiva con un cast porque ese archivo no pudo leerse completo en esta sesion.
4. Commitear un package-lock.json real a la raiz para poder reactivar cache: npm en los workflows de CI (ver lessons_learned.md, leccion 1). -- HECHO en PR #8.
5. Agregar puente real de `content:read`/`content:write` a `CAPABILITY_BRIDGES` en node-isolated-vm.ts, siguiendo el mismo patron `ivm.Reference` + `hostBridge` que ya cubre las otras 10 capacidades -- hoy esas 2 solo tienen el guard de denegacion, ningun plugin puede usarlas aunque esten concedidas.
6. Probar `DenoDeployAdapter` y `CloudflareWorkersForPlatformsAdapter` (v0.0.9.1) contra cuentas reales de prueba -- solo estan verificados con `fetch` mockeado (tests/e2e/sandbox-deno-deploy-adapter.test.ts, tests/e2e/sandbox-cloudflare-adapter.test.ts). Antes de produccion: confirmar el shape exacto de las respuestas de ambas APIs (puede haber cambiado desde que se escribio este codigo) y corregir cualquier discrepancia.
7. Desplegar el Worker "dispatcher" fijo que requiere `CloudflareWorkersForPlatformsAdapter` (ver comentario de infraestructura al inicio de cloudflare-workers-for-platforms.ts) -- sin esto, `dispatcherUrl` no tiene a que apuntar y el adaptador falla explicitamente al invocar (aunque si puede subir scripts).
8. Implementar el endpoint HTTP interno real que exponga `CapabilityHostBridge` sobre HTTP para los adaptadores edge (nuevo campo `SandboxExecutionInput.bridgeUrl`) -- hoy ningun handler de Portaless expone esto todavia, asi que las 9 capacidades no-red en Cloudflare/Deno fallan con "no hay bridge HTTP configurado" aunque esten concedidas.
