# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [x] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5, mergeado)
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
- [ ] Integracion real Cloudflare Workers for Platforms / Deno Deploy / Fastly Compute -- v0.0.9: decision explicita de alcance, se dejaron TODOs muy detallados (endpoints exactos de API, mapeo de capacidades, limitaciones de cada proveedor) en los 3 adaptadores bajo packages/plugin-sandbox/src/adapters/, pero NO se implemento la llamada real a ninguna API externa. Sigue pendiente.
- [x] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce -- v0.0.9, ver tests/unit/webbotauth-verify.test.ts (cache evita refetch en la segunda request al mismo operador; un nonce reusado en un replay exacto es rechazado).
- [x] Pool de isolates reutilizables para el commerce-plugin -- v0.0.9, `poolMaxIsolates` en NodeIsolatedVmAdapter, con aislamiento real de Context por ejecucion aunque el isolate subyacente se reutilice. Ver tests/e2e/sandbox-isolate-pool.test.ts.
- [x] Reordenamiento por arrastre dentro de un mismo slot de columnas -- v0.0.9: `makeDraggable` ahora tambien se aplica a los bloques ya renderizados en el canvas (no solo a los items de la paleta), con payload `{kind: "move-element", nodeId}`; la logica de mover/reordenar se extrajo a packages/atomic-elements/src/editor/tree-ops.ts (funciones puras, testeadas sin DOM en tests/e2e/atomic-elements-drag-drop-reorder.test.ts) para cubrir reordenamiento dentro del mismo contenedor, movimiento entre columnSlots distintos, y proteccion contra soltar un nodo dentro de su propio subarbol.

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
| #8 | feature/v0.0.9-capabilities-nonce-pool-dnd -> agentic | Este PR (borrador) | Puentes de capacidades (10/12, faltan content:read/write), cache+nonce Web Bot Auth, pool de isolates, drag-and-drop reorder; TODOs documentados para Cloudflare/Deno/Fastly (sin implementar) |

## Tareas manuales pendientes

1. Verificar manualmente que functions/admin/_middleware.js expone context.data.user antes de confiar en canWrite(role) server-side en produccion -- no se pudo leer su contenido en ninguna sesion de trabajo por un bug del conector de GitHub (ver lessons_learned.md).
2. Si se agregan nuevos endpoints de escritura al dashboard (permisos, configuracion, etc.), replicar el patron de canWrite(role) de functions/admin/pages/[slug].js.
3. Confirmar los nombres exactos de los campos title/description en packages/atomic-elements/src/types.ts (PageLayout) -- src/pages/paginas/[slug].astro los usa de forma defensiva con un cast porque ese archivo no pudo leerse completo en esta sesion.
4. Commitear un package-lock.json real a la raiz para poder reactivar cache: npm en los workflows de CI (ver lessons_learned.md, leccion 1).
5. Agregar puente real de `content:read`/`content:write` a `CAPABILITY_BRIDGES` en node-isolated-vm.ts, siguiendo el mismo patron `ivm.Reference` + `hostBridge` que ya cubre las otras 10 capacidades -- hoy esas 2 solo tienen el guard de denegacion, ningun plugin puede usarlas aunque esten concedidas.
