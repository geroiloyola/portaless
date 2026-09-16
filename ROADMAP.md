# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [x] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5, mergeado) creo D1PermissionStore/SqlitePermissionStore y sus equivalentes de ledger. Nota historica: esta linea se marco `[x]` en v0.0.6 pero resultó imprecisa -- el Centro de Permisos no tenia ningun endpoint que invocara su store (corregido en v0.0.9.2), y el ledger del Trust Layer si tenia su lado de escritura conectado (`functions/_middleware.js`) pero no el de lectura publica (corregido en v0.0.9.3). Con ambos rounds, esta linea ahora si esta completa end-to-end -- ver las 2 lineas de Prioridad media.
- [x] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5, mergeado)
- [x] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5, mergeado)
- [ ] Licenciamiento del proyecto: separar Portaless (core) bajo AGPL-3.0 con SDK de plugins bajo MIT -- v0.0.9.4. El `LICENSE` del repo nunca se actualizo desde el "First commit" (2026-09-12): sigue siendo MIT puro. Dado que el modelo de negocio real de Portaless depende de un ecosistema de plugins de terceros (AppPlace oficial, AppLibre comunitario, y apps privadas de terceros), MIT deja sin proteccion la posibilidad de que un competidor tome el core, lo modifique, y lo ofrezca como servicio de red sin devolver nada. Ver docs/architecture/licensing-boundaries.md (nuevo, v0.0.9.4) para la frontera exacta entre el core AGPL-3.0, el SDK de plugins en MIT, y los proyectos AppPlace/AppLibre/terceros que quedan fuera del alcance de licencia del core.
- [ ] Recuperacion de contrasena, 2FA, OAuth/SSO -- v0.0.9.4. Bloqueante real para llamar "MVP funcional" al proyecto: hoy `AuthService`/`_middleware.js` solo cubren login por password + cookie de sesion. Sin recuperacion de contrasena ni 2FA, cualquier despliegue real queda expuesto a perdida de acceso o a cuentas admin sin proteccion adicional. OAuth/SSO se incluye en la misma linea porque comparten superficie de UI/flujo con recuperacion de password (paginas publicas de `/admin/login` en adelante).

## Prioridad media
- [x] SEO/GEO nativo -- v0.0.8: imports de JsonLd + SeoHead conectados en src/pages/paginas/[slug].astro, usando los helpers de src/lib/seo.ts (getSiteUrl, buildCanonicalUrl). Ver docs/architecture/seo-geo.md.
- [x] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519) - mergeado
- [x] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements - mergeado
- [x] Migrar src/commerce/ a un plugin sandboxeado real - mergeado
- [~] canWrite(role) aplicado a todo el dashboard -- guard DOM-level mergeado; validacion server-side confirmada en el unico endpoint de escritura del dashboard identificado en el repo (functions/admin/pages/[slug].js, v0.0.8) y replicado en functions/admin/permissions/index.js (v0.0.9.2). PENDIENTE CRITICO: no se pudo confirmar en el PR de v0.0.8 si functions/admin/_middleware.js expone context.data.user -- verificar manualmente antes de considerar esta linea totalmente cerrada. Ver docs/architecture/server-side-role-checks.md.
- [x] Test end-to-end del sandbox de plugins corriendo en CI
- [x] Conectar la persistencia real (PageStore) dentro de functions/admin/pages/[slug].js -- v0.0.8: se agregaron implementaciones server-side D1PageStore y SqlitePageStore en packages/atomic-elements/src/persistence/stores/, mas store-factory.ts, todas cumpliendo la interfaz PageStore ya existente (load/save/list) para mantener compatibilidad con LocalStoragePageStore del editor cliente. Mismo patron que packages/permissions y packages/trust-layer/src/ledger. GET y PUT ya usan createPageStore(env) en vez de placeholders.
- [~] Puentes de capacidades restantes en isolated-vm -- v0.0.9: 9 capacidades nuevas (storage:read/write, email:send, commerce:read/checkout, media:read/write, agent:identify, site:admin) ya cruzan al isolate via `ivm.Reference.apply({result:{promise:true}})`, sumadas a network:fetch (ya existia) = 10/12 con puente real. Quedan `content:read`/`content:write` sin puente funcional -- ver linea nueva de v0.0.9.4 abajo.
- [ ] Puente real de content:read / content:write en el sandbox -- v0.0.9.4. Bloqueante real para el modelo de negocio de plugins: sin esto, ningun plugin de terceros (AppPlace, AppLibre, o privados) puede leer ni escribir contenido del sitio aunque tenga la capacidad concedida en el Centro de Permisos -- solo existe hoy el guard de denegacion, nunca se registro la funcion positiva. Mismo patron `ivm.Reference` + `hostBridge` que ya cubre las otras 10 capacidades (ver packages/plugin-sandbox/src/adapters/node-isolated-vm.ts).
- [~] Integracion real Cloudflare Workers for Platforms / Deno Deploy -- v0.0.9.1: implementada la llamada real a las APIs REST publicas de ambos proveedores (subida/creacion + invocacion), siguiendo el plan de 5 puntos documentado en el PR anterior. **NO verificado end-to-end contra una cuenta real** (sin credenciales de prueba disponibles al momento de este PR) -- la logica de construccion de requests, mapeo de capacidades y parsing de respuestas esta cubierta por tests con `fetch` mockeado (tests/e2e/sandbox-deno-deploy-adapter.test.ts, tests/e2e/sandbox-cloudflare-adapter.test.ts), pero el primer uso real contra cada API debe tratarse como una integracion nueva sin confirmar. Decision explicita de alcance: verificacion contra cuentas reales y despliegue del Worker dispatcher quedan fuera de v0.0.9.4 (requieren credenciales/infraestructura externa que no estan disponibles hoy). Detalles:
  - **Deno Deploy**: mapeo directo (`network:fetch` -> allowlist de host aplicado en el bootstrap subido; capacidades no-red -> bridge HTTP hacia `SandboxExecutionInput.bridgeUrl`, nuevo campo del contrato). Crea una deployment nueva por `execute()` -- limpieza/reuso de deployments viejas queda pendiente (ver nota en el propio archivo).
  - **Cloudflare Workers for Platforms**: sube/actualiza el script via PUT (scriptName deterministico por `name@version`, reusa en vez de acumular). **Requiere infraestructura externa a este adaptador**: un Worker "dispatcher" fijo desplegado por namespace (no lo despliega este codigo) que resuelve `env.DISPATCH_NAMESPACE.get(scriptName)` -- sin `dispatcherUrl` configurado, el adaptador puede subir scripts pero falla explicitamente al intentar invocarlos. El filtrado autoritativo de red via "outbound worker" tampoco lo configura este adaptador (ver comentario extenso al inicio de cloudflare-workers-for-platforms.ts).
  - **Fastly Compute**: SIN cambios, sigue solo con TODOs documentados (decision explicita: requiere un plugin ya compilado a Wasm para poder probarse, no disponible). Fuera de alcance tambien en v0.0.9.4.
  - Se agrego `bridgeUrl?: string` a `SandboxExecutionInput` (packages/plugin-sandbox/src/types.ts) -- URL de un endpoint HTTP interno de Portaless que expone `CapabilityHostBridge` para adaptadores que ejecutan el plugin fuera de este proceso Node; implementar ese endpoint interno real queda fuera de alcance de v0.0.9.4 (ver Baja prioridad).
- [x] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce -- v0.0.9, ver tests/unit/webbotauth-verify.test.ts (cache evita refetch en la segunda request al mismo operador; un nonce reusado en un replay exacto es rechazado).
- [x] Pool de isolates reutilizables para el commerce-plugin -- v0.0.9, `poolMaxIsolates` en NodeIsolatedVmAdapter, con aislamiento real de Context por ejecucion aunque el isolate subyacente se reutilice. Ver tests/e2e/sandbox-isolate-pool.test.ts.
- [x] Reordenamiento por arrastre dentro de un mismo slot de columnas -- v0.0.9: `makeDraggable` ahora tambien se aplica a los bloques ya renderizados en el canvas (no solo a los items de la paleta), con payload `{kind: "move-element", nodeId}`; la logica de mover/reordenar se extrajo a packages/atomic-elements/src/editor/tree-ops.ts (funciones puras, testeadas sin DOM en tests/e2e/atomic-elements-drag-drop-reorder.test.ts) para cubrir reordenamiento dentro del mismo contenedor, movimiento entre columnSlots distintos, y proteccion contra soltar un nodo dentro de su propio subarbol.
- [x] Centro de Permisos conectado a persistencia real end-to-end -- v0.0.9.2: nuevo endpoint `functions/admin/permissions/index.js` (GET snapshot con seed de subjects conocidos + defaults no concedidos, PUT otorga/revoca con guard server-side `canWrite(role)=="admin"`, mismo patron que `functions/admin/pages/[slug].js`), UI (`permission-center-ui.ts`) reescrita para que el unico camino de escritura sea `onToggle` (antes llamaba a `store.setGrant()` directo Y a `onToggle`, lo cual no tenia sentido porque D1/SQLite son server-side-only), nueva pagina `src/pages/admin/permissions.astro` con estados de carga/guardado/error. 9 tests nuevos en `tests/unit/admin-permissions-role-check.test.ts` (401/403/400/happy-path GET+PUT). Limitacion conocida: el catalogo de subjects (`hello-plugin`, `commerce-plugin`) esta hardcodeado en el endpoint, no viene de un registro dinamico de plugins instalados (no existe todavia).
- [x] Trust Layer / ledger conectado a persistencia real end-to-end -- v0.0.9.3. Correccion de diagnostico: la nota anterior de este roadmap decia que "ningun endpoint HTTP del repo lo invoca", lo cual era IMPRECISO -- `functions/_middleware.js` ya llamaba a `recordAgentAccess(ledgerStore, ...)` con `createUsageLedgerStore(env)` (D1/SQLite reales) desde v0.0.6, en cada request de un agente detectado. La escritura SI estaba conectada. Lo que realmente faltaba era el lado de LECTURA: no existia ningun endpoint que expusiera ese ledger ya escrito de vuelta como JSON publico. v0.0.9.3 agrega `functions/.well-known/portaless-usage-log.json.js` (`GET`, publico -- sin guard de sesion, mismo criterio de transparencia que `portaless-content-policy.json` -- soporta `?period=YYYY-MM`, default al mes UTC actual, 400 en formato invalido, 200 con `agents:[]` si el periodo no tiene trafico todavia). 5 tests nuevos en `tests/unit/usage-log-endpoint.test.ts`, incluyendo un test de integracion real contra `recordAgentAccess` (escribe entradas, confirma que el endpoint las lee de vuelta correctamente agregadas).
- [x] Bug de nombre de binding D1 inconsistente entre factories -- corregido en v0.0.9.3 (encontrado en v0.0.9.2, quedo pendiente ese round). `packages/atomic-elements/src/persistence/store-factory.ts` (`createPageStore`) leia `env.PORTALESS_DB`; se alineo a `env.DB` como las otras 3 factories (auth, permissions, trust-layer) y como documenta `wrangler.toml`. Sin alias de compatibilidad para el binding D1 (ningun despliegue real llego a configurarlo con el nombre viejo). Se unificaron ademas los nombres de path SQLite: `PAGES_SQLITE_PATH` -> `PORTALESS_SQLITE_PATH` (unico archivo self-hosted para las 4 factories en vez de 4 separados), este si con fallback al nombre viejo por si un self-hosted real ya lo tenia configurado. Se actualizaron los comentarios y el test existente (`tests/unit/admin-pages-role-check.test.ts`) que referenciaban el nombre viejo. Suite completa tras el fix: 60/60 tests (10 archivos).
- [ ] Automatizar la creacion del admin inicial en D1 + comando unico de `schema.sql` -- v0.0.9.4. Hoy levantar una instancia nueva (D1 o SQLite self-hosted) requiere pasos manuales dispersos (aplicar schema.sql de cada paquete por separado, crear a mano el primer usuario admin). Se agrupa en una sola linea porque comparten el mismo objetivo de developer experience: reducir la friccion de instalacion a un comando.

## Baja prioridad
- [ ] Cobro real Pay per Crawl
- [ ] MCP nativo
- [ ] Identidad AT Protocol
- [ ] Protocol APW resolver real
- [ ] Agente raiz de lenguaje natural
- [ ] Desplegar el Worker "dispatcher" fijo de Cloudflare Workers for Platforms (ver tarea manual 7)
- [ ] Implementar el endpoint HTTP interno real de CapabilityHostBridge para adaptadores edge (ver tarea manual 8)
- [ ] Verificar DenoDeployAdapter y CloudflareWorkersForPlatformsAdapter contra cuentas reales (ver tarea manual 6)

## Vision largo plazo
- [ ] Lenguaje de programacion de intencion humana

## Version v0.0.9.4 -- alcance explicito (ultima version antes del MVP)

Objetivo: cerrar las 4 brechas que impiden llamar "MVP funcional y protegido" al proyecto. Todo lo demas en Baja prioridad y Vision largo plazo queda fuera de esta version por decision explicita de alcance -- no por falta de valor, sino porque ninguno bloquea que un usuario real pueda instalar Portaless, crear una cuenta segura, y usar plugins de terceros de forma aislada.

1. Licenciamiento: AGPL-3.0 en el core + MIT en el SDK de plugins + `docs/architecture/licensing-boundaries.md`.
2. Recuperacion de contrasena, 2FA, OAuth/SSO.
3. Puente real de `content:read`/`content:write` en el sandbox.
4. Automatizar admin inicial en D1 + comando unico de `schema.sql`.

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
| #10 | feature/v0.0.9.1-real-edge-adapters -> agentic | Mergeado | Integracion real Cloudflare Workers for Platforms + Deno Deploy (sin verificar contra cuenta real); Fastly sin cambios |
| #11 | agentic -> main | Mergeado | v0.0.9.1 + v0.0.9.2 (Centro de Permisos conectado end-to-end) promovidos a main |
| #12 | agentic -> main | Mergeado | v0.0.9.3: ledger del Trust Layer expuesto en /.well-known/, fix de binding D1 inconsistente |
| #13 | feature/v0.0.9.4-licensing-auth-content-bridge-dx -> agentic | Este PR | v0.0.9.4: separacion de licencias (AGPL-3.0 core + MIT SDK), fronteras documentadas AppPlace/AppLibre/terceros, recuperacion de contrasena + 2FA + OAuth/SSO, puente real content:read/write, automatizacion de admin inicial + schema.sql unico |

## Tareas manuales pendientes

1. Verificar manualmente que functions/admin/_middleware.js expone context.data.user antes de confiar en canWrite(role) server-side en produccion -- no se pudo leer su contenido en ninguna sesion de trabajo por un bug del conector de GitHub (ver lessons_learned.md).
2. Si se agregan nuevos endpoints de escritura al dashboard (permisos, configuracion, etc.), replicar el patron de canWrite(role) de functions/admin/pages/[slug].js.
3. Confirmar los nombres exactos de los campos title/description en packages/atomic-elements/src/types.ts (PageLayout) -- src/pages/paginas/[slug].astro los usa de forma defensiva con un cast porque ese archivo no pudo leerse completo en esta sesion.
4. Commitear un package-lock.json real a la raiz para poder reactivar cache: npm en los workflows de CI (ver lessons_learned.md, leccion 1). -- HECHO en PR #8.
5. Agregar puente real de `content:read`/`content:write` a `CAPABILITY_BRIDGES` en node-isolated-vm.ts, siguiendo el mismo patron `ivm.Reference` + `hostBridge` que ya cubre las otras 10 capacidades -- ver v0.0.9.4 arriba, en progreso en este PR.
6. Probar `DenoDeployAdapter` y `CloudflareWorkersForPlatformsAdapter` (v0.0.9.1) contra cuentas reales de prueba -- solo estan verificados con `fetch` mockeado. Fuera de alcance de v0.0.9.4 por falta de credenciales de prueba.
7. Desplegar el Worker "dispatcher" fijo que requiere `CloudflareWorkersForPlatformsAdapter`. Fuera de alcance de v0.0.9.4.
8. Implementar el endpoint HTTP interno real que exponga `CapabilityHostBridge` sobre HTTP para los adaptadores edge. Fuera de alcance de v0.0.9.4.
9. Revisar y, si aplica, re-licenciar bajo AGPL-3.0 cualquier codigo de terceros vendorizado o dependencia embebida directamente en el arbol del repo (no dependencias de npm, que mantienen su propia licencia) -- verificar que no haya conflicto de licencia antes de publicar el cambio a AGPL-3.0.
10. Publicar `docs/architecture/licensing-boundaries.md` de forma visible desde el README para que desarrolladores de plugins de terceros conozcan la frontera de licencia antes de empezar a escribir un plugin.
