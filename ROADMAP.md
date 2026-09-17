# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Estructura de este roadmap

Reorganizado en 3 categorias, no por prioridad sino por quien es responsable de cada pieza:

- **Funcionalidades en Produccion**: lo que ya esta hecho, mergeado a `main`, y funcional hoy.
- **Funcionalidades Internas en Desarrollo**: lo que falta, pero es responsabilidad exclusiva de Portaless -- no depende de ningun tercero.
- **Funciones Externas**: lo que depende de terceros (empresas de pago, proveedores de nube, otros proyectos open source) para completarse.

---

## Funcionalidades en Produccion

- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [x] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5, mergeado) creo D1PermissionStore/SqlitePermissionStore y sus equivalentes de ledger. Nota historica: esta linea se marco `[x]` en v0.0.6 pero resultó imprecisa -- el Centro de Permisos no tenia ningun endpoint que invocara su store (corregido en v0.0.9.2), y el ledger del Trust Layer si tenia su lado de escritura conectado (`functions/_middleware.js`) pero no el de lectura publica (corregido en v0.0.9.3). Con ambos rounds, esta linea ahora si esta completa end-to-end -- ver las 2 lineas correspondientes mas abajo.
- [x] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5, mergeado)
- [x] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5, mergeado)
- [x] Licenciamiento del proyecto: separar Portaless (core) bajo AGPL-3.0 con SDK de plugins bajo MIT -- v0.0.9.4 (PR #13, mergeado). LICENSE reemplazado por AGPL-3.0 + linking exception para el Plugin SDK; LICENSE-SDK (MIT) agregado; docs/architecture/licensing-boundaries.md documenta la frontera exacta entre el core AGPL-3.0, el SDK de plugins en MIT, y los proyectos AppPlace/AppLibre/terceros.
- [x] Recuperacion de contrasena, 2FA, OAuth/SSO -- v0.0.9.4 (PR #15, mergeado a agentic, luego a main via PR #17). AuthService gano completeMfaLogin, beginTotpEnrollment, confirmTotpEnrollment, disableTotp, requestPasswordReset, completePasswordReset, loginWithOAuth. 6 endpoints/paginas nuevos, 15 tests.
- [x] functions/admin/login.js maneja el flujo de 2FA end-to-end -- v0.0.9.5 (PR #16, mergeado). Si result.mfaRequired && result.mfaChallengeToken, redirige a /admin/login-mfa?challenge=<token>. Sin cambios de comportamiento para usuarios sin 2FA activo.
- [x] SEO/GEO nativo -- v0.0.8: imports de JsonLd + SeoHead conectados en src/pages/paginas/[slug].astro, usando los helpers de src/lib/seo.ts (getSiteUrl, buildCanonicalUrl). Ver docs/architecture/seo-geo.md.
- [x] Campos title/description de PageLayout en src/pages/paginas/[slug].astro -- CONFIRMADO ya resuelto (v0.0.8): el archivo real accede directamente a `layout.title`/`layout.description` sin cast defensivo, con un comentario inline explicito que dice "types.ts SI declara title (obligatorio) y description (opcional) en PageLayout, por lo que ya no hace falta el cast defensivo". Este roadmap lo marcaba como pendiente en versiones anteriores por informacion desactualizada, no por un problema real en el codigo -- corregido en v0.0.9.9 tras revisar el archivo completo.
- [x] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519) - mergeado
- [x] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements - mergeado
- [x] Migrar src/commerce/ a un plugin sandboxeado real - mergeado
- [x] canWrite(role) aplicado a todo el dashboard -- guard DOM-level + validacion server-side confirmada en functions/admin/pages/[slug].js y functions/admin/permissions/index.js. CONFIRMADO en v0.0.9.7: functions/admin/_middleware.js SI expone `context.data.user` (con `session` como alias de compatibilidad) -- linea que en versiones anteriores de este roadmap figuraba como "pendiente de verificar manualmente" por un bug del conector de GitHub que impedia leer el archivo completo; verificado ahora via busqueda de codigo, comentario inline confirma que `user` existe especificamente "para el guard de permisos server-side". Ver docs/architecture/server-side-role-checks.md.
- [x] Test end-to-end del sandbox de plugins corriendo en CI
- [x] Conectar la persistencia real (PageStore) dentro de functions/admin/pages/[slug].js -- v0.0.8: se agregaron implementaciones server-side D1PageStore y SqlitePageStore en packages/atomic-elements/src/persistence/stores/, mas store-factory.ts, todas cumpliendo la interfaz PageStore ya existente (load/save/list) para mantener compatibilidad con LocalStoragePageStore del editor cliente. Mismo patron que packages/permissions y packages/trust-layer/src/ledger. GET y PUT ya usan createPageStore(env) en vez de placeholders.
- [x] Puentes de capacidades restantes en isolated-vm -- v0.0.9: 9 capacidades nuevas (storage:read/write, email:send, commerce:read/checkout, media:read/write, agent:identify, site:admin) ya cruzan al isolate via `ivm.Reference.apply({result:{promise:true}})`, sumadas a network:fetch (ya existia) = 10/12 con puente real. COMPLETADO en v0.0.9.4 (PR #15): content:read/content:write se integraron al mismo patron -- 12/12 capacidades del catalogo con puente real. CapabilityHostBridge en types.ts actualizado con ambos campos en un PR de seguimiento (v0.0.9.6, PR #18, mergeado). Ver packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md.
- [x] Limpiar el tipo local extendido en node-isolated-vm.ts -- v0.0.9.9. `BaseCapabilityHostBridge & {contentRead, contentWrite}` eliminado; el archivo ahora importa `CapabilityHostBridge` directo desde `../types` (completo desde el PR #18, v0.0.9.6). Cambio cosmetico, sin impacto funcional -- resto del archivo intacto.
- [x] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce -- v0.0.9, ver tests/unit/webbotauth-verify.test.ts (cache evita refetch en la segunda request al mismo operador; un nonce reusado en un replay exacto es rechazado).
- [x] Pool de isolates reutilizables para el commerce-plugin -- v0.0.9, `poolMaxIsolates` en NodeIsolatedVmAdapter, con aislamiento real de Context por ejecucion aunque el isolate subyacente se reutilice. Ver tests/e2e/sandbox-isolate-pool.test.ts.
- [x] Reordenamiento por arrastre dentro de un mismo slot de columnas -- v0.0.9: `makeDraggable` ahora tambien se aplica a los bloques ya renderizados en el canvas (no solo a los items de la paleta), con payload `{kind: "move-element", nodeId}`; la logica de mover/reordenar se extrajo a packages/atomic-elements/src/editor/tree-ops.ts (funciones puras, testeadas sin DOM en tests/e2e/atomic-elements-drag-drop-reorder.test.ts) para cubrir reordenamiento dentro del mismo contenedor, movimiento entre columnSlots distintos, y proteccion contra soltar un nodo dentro de su propio subarbol.
- [x] Centro de Permisos conectado a persistencia real end-to-end -- v0.0.9.2: nuevo endpoint `functions/admin/permissions/index.js` (GET snapshot con seed de subjects conocidos + defaults no concedidos, PUT otorga/revoca con guard server-side `canWrite(role)=="admin"`, mismo patron que `functions/admin/pages/[slug].js`), UI (`permission-center-ui.ts`) reescrita para que el unico camino de escritura sea `onToggle` (antes llamaba a `store.setGrant()` directo Y a `onToggle`, lo cual no tenia sentido porque D1/SQLite son server-side-only), nueva pagina `src/pages/admin/permissions.astro` con estados de carga/guardado/error. 9 tests nuevos en `tests/unit/admin-permissions-role-check.test.ts` (401/403/400/happy-path GET+PUT).
- [x] Trust Layer / ledger conectado a persistencia real end-to-end -- v0.0.9.3. `functions/_middleware.js` llama a `recordAgentAccess(ledgerStore, ...)` con `createUsageLedgerStore(env)` (D1/SQLite reales) en cada request de un agente detectado. `GET /.well-known/portaless-usage-log.json` expone ese ledger de vuelta como JSON publico, con `?period=YYYY-MM` opcional. 5 tests en `tests/unit/usage-log-endpoint.test.ts`.
- [x] Bug de nombre de binding D1 inconsistente entre factories -- corregido en v0.0.9.3. `createPageStore` alineado a `env.DB` como las otras 3 factories. Nombres de path SQLite unificados (`PORTALESS_SQLITE_PATH`).
- [x] Automatizar la creacion del admin inicial en D1 + comando unico de `schema.sql` -- v0.0.9.4 (PR #15, mergeado). `schema.sql` (raiz) generado a partir de los schema.sql de cada paquete + tabla de password reset; `scripts/setup.mjs` aplica el schema y crea el admin inicial en un solo comando (`npm run setup`); `scripts/generate-schema.mjs` regenera el maestro si cambia algun paquete. Cloudflare D1 sigue usando `wrangler d1 execute` por separado (documentado, no automatizado). La prueba de este comando contra SQLite real sigue pendiente -- ver "Funcionalidades Internas en Desarrollo".
- [x] Persistencia real D1/SQLite para PasswordResetStore -- v0.0.9.7 (PR #19, mergeado). `D1PasswordResetStore` y `SqlitePasswordResetStore`, mismo patron que los stores de usuarios/sesiones, usando la tabla `password_reset_requests` que ya existia en `schema.sql` desde v0.0.9.4.

---

## Funcionalidades Internas en Desarrollo

Lo que falta, pero es responsabilidad exclusiva de Portaless resolver -- no depende de ningun proveedor externo, tercero, ni proyecto aparte.

- [ ] Probar `npm run setup` localmente contra un archivo SQLite real antes de confiar en el flujo de instalacion documentado en scripts/SETUP.md. Requiere ejecucion manual con Node y `better-sqlite3` instalado; ninguna herramienta disponible en las sesiones de trabajo hasta ahora tiene un shell de Node conectado al repo real para hacerlo. Verificacion manual del propietario del proyecto.
- [ ] MCP nativo
- [ ] Identidad AT Protocol
- [ ] Protocol APW resolver real
- [~] Ecosistema de plugins abierto+cerrado con trustScore comunitario -- v0.0.9.9, avanzado parcialmente; v0.0.9.10 conecto el registro al Centro de Permisos. Diseño inspirado en Shopify App Store / WooCommerce.org / Android Play Store: el catalogo de plugins es abierto por defecto (cualquiera puede registrar uno, `sourceType: "open"` o `"closed"`), y la comunidad regula la confianza via un `trustScore` publico (promedio de votos 1-5) en vez de que Portaless certifique nada. Se agrego `packages/plugin-sandbox/src/registry/plugin-registry.ts` (interfaz `PluginRegistryStore` + `InMemoryPluginRegistryStore` de referencia) y las tablas `plugin_registry`/`plugin_trust_votes` en `schema.sql`. **v0.0.9.10**: se agrego `packages/plugin-sandbox/src/registry/store-factory.ts` (`createPluginRegistryStore(env)`, seedeado con `hello-plugin`/`commerce-plugin`) y `functions/admin/permissions/index.js` ya deriva su catalogo de subjects de este registro real, no de una lista hardcodeada -- punto (2) de la lista original, cerrado. **Pendiente para cerrar esta linea del todo**: (1) implementar `D1PluginRegistryStore`/`SqlitePluginRegistryStore` -- el registro sigue en memoria, por lo que se resetea al seed inicial en cada despliegue/reinicio; (2) UI en el Centro de Permisos para mostrar el trustScore antes de conceder capacidades. Ver la nueva seccion "Ecosistema de plugins" mas abajo para la vision completa de largo plazo (compatibilidad con AT Protocol como posible AppView).
- [~] Endpoint HTTP interno real que exponga `CapabilityHostBridge` sobre HTTP (`bridgeUrl`, ya definido en `SandboxExecutionInput` desde v0.0.9.1) -- v0.0.9.9, codigo completo en `functions/api/internal/capability-bridge.js`: valida `Authorization: Bearer <PORTALESS_INTERNAL_BRIDGE_TOKEN>`, consulta `PermissionStore` real para verificar la concesion, y despacha `content:read`/`content:write` a `PageStore` real (las 9 capacidades restantes responden 501 explicito, mismo principio NOT_CONFIGURED que `node-isolated-vm.ts`). **Pendiente para cerrar esta linea**: (1) agregar `PORTALESS_INTERNAL_BRIDGE_TOKEN` a `.env.example`; (2) modificar `deno-deploy.ts` y `cloudflare-workers-for-platforms.ts` para que apunten `bridgeUrl` a este endpoint; (3) prueba real contra una cuenta de Cloudflare/Deno (ver "Funciones Externas" -- ese ultimo paso depende de un proveedor externo, el resto es responsabilidad interna).
- [ ] Confirmar los nombres exactos de los campos title/description en packages/atomic-elements/src/types.ts (PageLayout) -- CERRADO, ver linea movida a "Funcionalidades en Produccion" arriba.

---

## Funciones Externas

Lo que depende de un tercero -- otra empresa, otro proveedor de nube, u otro proyecto open source -- para completarse. Portaless expone el protocolo, el SDK, o el contrato tecnico necesario, pero la pieza en si se construye y se mantiene fuera de este repositorio.

- [ ] Cobro real Pay per Crawl -- ver nota de alcance abajo, seccion "Trust Layer y Pay per Crawl: protocolo abierto, no asegurador".
- [ ] Agente raiz de lenguaje natural -- ver nota de alcance abajo, seccion "Agente generador de sitios: via SDK externo, no interno".
- [ ] Lenguaje de programacion de intencion humana -- ver nota de alcance abajo, seccion "Agente generador de sitios: via SDK externo, no interno".
- [ ] AppPlace y AppLibre (marketplace de plugins) -- ver nota de alcance abajo, seccion "AppPlace y AppLibre: proyectos aparte, asociados oficiales".
- [~] Integracion real Cloudflare Workers for Platforms / Deno Deploy -- v0.0.9.1: implementada la llamada real a las APIs REST publicas de ambos proveedores (subida/creacion + invocacion), siguiendo el plan de 5 puntos documentado en el PR anterior. **NO verificado end-to-end contra una cuenta real** (sin credenciales de prueba disponibles al momento de este PR) -- la logica de construccion de requests, mapeo de capacidades y parsing de respuestas esta cubierta por tests con `fetch` mockeado (tests/e2e/sandbox-deno-deploy-adapter.test.ts, tests/e2e/sandbox-cloudflare-adapter.test.ts), pero el primer uso real contra cada API debe tratarse como una integracion nueva sin confirmar. Sigue en espera hasta contar con cuentas de prueba reales de ambos proveedores -- sin fecha estimada. Detalles:
  - **Deno Deploy**: mapeo directo (`network:fetch` -> allowlist de host aplicado en el bootstrap subido; capacidades no-red -> bridge HTTP hacia `SandboxExecutionInput.bridgeUrl`, ya implementado en v0.0.9.9 -- ver "Funcionalidades Internas en Desarrollo"). Crea una deployment nueva por `execute()` -- limpieza/reuso de deployments viejas queda pendiente (ver nota en el propio archivo).
  - **Cloudflare Workers for Platforms**: sube/actualiza el script via PUT (scriptName deterministico por `name@version`, reusa en vez de acumular). **Requiere infraestructura externa a este adaptador**: un Worker "dispatcher" fijo desplegado por namespace (no lo despliega este codigo) que resuelve `env.DISPATCH_NAMESPACE.get(scriptName)` -- sin `dispatcherUrl` configurado, el adaptador puede subir scripts pero falla explicitamente al intentar invocarlos. El filtrado autoritativo de red via "outbound worker" tampoco lo configura este adaptador (ver comentario extenso al inicio de cloudflare-workers-for-platforms.ts).
  - **Fastly Compute**: SIN cambios en este PR, sigue solo con TODOs documentados (decision explicita: requiere un plugin ya compilado a Wasm para poder probarse, no disponible).
- [ ] Desplegar el Worker "dispatcher" fijo de Cloudflare Workers for Platforms -- requiere infraestructura desplegada en una cuenta real de Cloudflare, fuera de este repositorio.
- [ ] Verificar DenoDeployAdapter y CloudflareWorkersForPlatformsAdapter contra cuentas reales -- en espera de credenciales de prueba, sin fecha estimada.

---

## Ecosistema de plugins: abierto por defecto, regulado por la comunidad

Vision de largo plazo para el catalogo de plugins (v0.0.9.9 en adelante), inspirada explicitamente en 3 modelos ya probados a escala: Shopify App Store, WooCommerce.org, y Android/Google Play.

**El principio central**: el catalogo NO es una tienda curada por Portaless desde el dia uno -- es abierto. Cualquier desarrollador puede registrar su plugin, sea de codigo abierto o cerrado (`sourceType: "open"` | "closed"`). Portaless no certifica, no audita, y no garantiza ningun plugin por el simple hecho de estar listado -- eso ya quedaba dicho en la seccion "AppPlace y AppLibre" de este roadmap, y se mantiene.

**Lo que si aporta Portaless**: un `trustScore` publico y transparente (promedio de votos 1-5 de la comunidad, visible antes de conceder cualquier capacidad desde el Centro de Permisos) para que la propia comunidad regule la confianza -- exactamente el mismo principio que las resenas de Play Store o los ratings de WooCommerce.org, pero calculado de forma abierta (`plugin_trust_votes` es una tabla consultable, no un numero opaco). Para plugins de codigo cerrado, el campo `auditedBy` permite registrar que una entidad externa (por ejemplo, el futuro AppPlace) revizo el plugin -- informativo, nunca una certificacion de Portaless.

**Por que esto importa a largo plazo**: esta arquitectura (protocolo abierto de identidad de agentes via Web Bot Auth + RFC 9421, sandboxing real de capacidades, y ahora un registro de plugins con confianza transparente) es estructuralmente compatible con AT Protocol -- el mismo protocolo detras de Bluesky, diseñado para permitir multiples "AppViews" sobre una capa de datos compartida. Si Identidad AT Protocol (ver "Funcionalidades Internas en Desarrollo") se implementa en el futuro, Portaless podria funcionar como un AppView compatible con AT Protocol -- una vision de largo plazo que posicionaria a Portaless como una alternativa descentralizada y auditable a ecosistemas cerrados como Android, sin pretender competir con Android en el corto plazo ni prometer una fecha para esto.

## Trust Layer y Pay per Crawl: protocolo abierto, no asegurador

Decision de arquitectura explicita: Portaless (el Trust Layer) define y expone el **protocolo** -- identificacion criptografica de agentes de IA (Web Bot Auth, RFC 9421), politicas de acceso (`allow`/`charge`/`block`), y un ledger publico de trazabilidad de quien accedio a que contenido. Lo que Portaless **no hace, y no debe hacer**, es asegurar que un cobro efectivamente se realice ni procesar el dinero en si.

La razon es simple y honesta: garantizar un cobro real requiere licencias financieras, cumplimiento regulatorio (PCI-DSS para tarjetas, KYC/AML segun jurisdiccion para cripto) que corresponden a una empresa financiera regulada, no a un proyecto de software abierto. Portaless actuando como "asegurador" de pagos sin ser esa entidad regulada seria un riesgo legal y de confianza innecesario para el proyecto y para quien lo use.

El diseño correcto, y el que se mantiene: terceros (Stripe, Mercado Pago, plataformas de cripto, o cualquier otro procesador) construyen su propia capa de cobro **sobre** el protocolo que expone el Trust Layer -- leyendo el ledger, verificando identidad de agentes, aplicando sus propias politicas de riesgo y cumplimiento. Esas integraciones de terceros son candidatas naturales para listarse en AppPlace, pero como proyectos independientes, nunca como parte del core de Portaless.

## Agente generador de sitios: via SDK externo, no interno

La tarea "Agente raiz de lenguaje natural" y la "Vision largo plazo" de un lenguaje de programacion de intencion humana **no se desarrollaran dentro de este repositorio**. Se conectaran mediante un SDK con un proyecto aparte, tambien open source, actualmente en desarrollo: un lenguaje de programacion pensado para generar agentes/programas a partir de lenguaje natural (Nuvid).

Ambos proyectos (Portaless y ese lenguaje) tendran su propio SDK de conexion -- el mismo patron ya usado para el Plugin SDK (MIT) descrito en `docs/architecture/licensing-boundaries.md`. Esto mantiene a Portaless (AGPL-3.0) sin depender en su nucleo de un proyecto todavia mas experimental, y evita mezclar licencias o ciclos de release. Cuando ese proyecto externo tenga una version estable, la integracion se documentara aqui como una conexion entre proyectos, no como una feature interna del roadmap de Portaless.

## AppPlace y AppLibre: proyectos aparte, asociados oficiales

AppPlace (marketplace cerrado, con capacidad de cobro y curaduria comercial) y AppLibre (registro comunitario abierto) **no son parte de este repositorio ni se desarrollaran dentro de Portaless**. Seran proyectos aparte, mantenidos por el mismo autor de Portaless (mas la comunidad, en el caso de AppLibre), con estatus de "asociado oficial" -- es decir, reconocidos y enlazados desde la documentacion de Portaless, pero con su propio repositorio, ciclo de releases, y modelo de negocio independiente.

**Advertencia honesta que debe quedar visible para cualquier usuario**: ni Portaless ni sus asociados oficiales (AppPlace, AppLibre) garantizan la calidad, seguridad, ni el comportamiento de plugins de terceros publicados en cualquier marketplace, presente o futuro. La arquitectura de sandboxing (`packages/plugin-sandbox`) limita lo que un plugin PUEDE hacer segun las capacidades concedidas explicitamente desde el Centro de Permisos -- pero eso es una barrera tecnica de contencion, no una certificacion de que un plugin listado sea confiable, este libre de bugs, o haga lo que dice hacer. Cualquier futuro proceso de curaduria de AppPlace es responsabilidad de ese proyecto aparte, no una garantia retroactiva que Portaless asuma sobre plugins ya instalados.

## Pull Requests
| PR | Rama | Estado | Contenido |
|---|---|---|---|
| #1 | chore/github-workflows | Mergeado | gitignore, workflows |
| #2 | docs/roadmap | Mergeado | ROADMAP inicial |
| #3 | agentic | Mergeado | AGENT.md |
| #4 | agentic | Mergeado | auth + persistencia |
| #5 | agentic | Mergeado | v0.0.6 + v0.0.7 |
| #6 | feature/v0.0.8-seo-canwrite-pagestore -> agentic | Mergeado | SEO imports conectados, PageStore real, canWrite server-side |
| #7 | agentic -> main | Mergeado | v0.0.8 promovido a main |
| #8 | feature/v0.0.9-capabilities-nonce-pool-dnd -> agentic | Mergeado | Puentes de capacidades (10/12), cache+nonce Web Bot Auth, pool de isolates, drag-and-drop |
| #9 | agentic -> main | Mergeado | v0.0.9 promovido a main |
| #10 | feature/v0.0.9.1-real-edge-adapters -> agentic | Mergeado | Cloudflare Workers for Platforms + Deno Deploy (sin verificar contra cuenta real) |
| #11 | agentic -> main | Mergeado | v0.0.9.1 + v0.0.9.2 promovidos a main |
| #12 | agentic -> main | Mergeado | v0.0.9.3: ledger publico, fix binding D1 |
| #13 | feature/v0.0.9.4-licensing-auth-content-bridge-dx -> agentic | Mergeado | Licenciamiento AGPL-3.0 core + MIT SDK |
| #14 | agentic -> main | Mergeado | Licenciamiento promovido a main |
| #15 | feature/v0.0.9.4-licensing-auth-content-bridge-dx -> agentic | Mergeado | 2FA/reset/OAuth, bridge content:read/write, instalacion en un comando |
| #16 | fix/v0.0.9.5-mfa-login-redirect-roadmap-cleanup -> agentic | Mergeado | Fix login.js mfaRequired, ROADMAP.md actualizado |
| #17 | agentic -> main | Mergeado | v0.0.9.4 + v0.0.9.5 completos promovidos a main |
| #18 | fix/v0.0.9.6-capability-host-bridge-content-types -> main | Mergeado | contentRead/contentWrite agregados a CapabilityHostBridge |
| #19 | fix/v0.0.9.7-password-reset-persistence-roadmap -> main | Mergeado | Persistencia real D1/SQLite para PasswordResetStore, ROADMAP.md con aclaraciones de negocio |
| #20 | docs/v0.0.9.8-roadmap-restructure -> main | Mergeado | ROADMAP.md reorganizado en 3 categorias: Produccion / Internas / Externas |
| #21 | feat/v0.0.9.9-plugin-ecosystem -> main | Abierto | Limpieza de tipos en node-isolated-vm.ts, registro dinamico de plugins con trustScore comunitario, endpoint HTTP interno de CapabilityHostBridge, ROADMAP.md actualizado |

## Tareas manuales pendientes

1. Probar `npm run setup` localmente contra un archivo SQLite real antes de confiar en el flujo de instalacion documentado en scripts/SETUP.md. Requiere ejecucion manual con Node y `better-sqlite3` instalado; ninguna herramienta disponible en las sesiones de trabajo hasta ahora tiene un shell de Node conectado al repo real para hacerlo. Verificacion manual del propietario del proyecto.
2. Si se agregan nuevos endpoints de escritura al dashboard (permisos, configuracion, etc.), replicar el patron de canWrite(role) de functions/admin/pages/[slug].js.
3. Commitear un package-lock.json real a la raiz para poder reactivar cache: npm en los workflows de CI. -- HECHO en PR #8.
4. Revisar y, si aplica, re-licenciar bajo AGPL-3.0 cualquier codigo de terceros vendorizado o dependencia embebida directamente en el arbol del repo -- REVISADO en v0.0.9.5: sin vendor/third_party en el arbol raiz; infra/ es config propia de despliegue; plugins-registry/ solo tiene un README. Sin hallazgos, no sustituye una auditoria legal formal de las dependencias de npm.
5. Probar `DenoDeployAdapter` y `CloudflareWorkersForPlatformsAdapter` (v0.0.9.1) contra cuentas reales de prueba -- solo estan verificados con `fetch` mockeado. En espera de credenciales, sin fecha estimada.
6. Desplegar el Worker "dispatcher" fijo que requiere `CloudflareWorkersForPlatformsAdapter`. Fuera de alcance hasta contar con cuenta real.
7. Agregar `PORTALESS_INTERNAL_BRIDGE_TOKEN` a `.env.example`, y modificar `deno-deploy.ts`/`cloudflare-workers-for-platforms.ts` para que apunten `bridgeUrl` al endpoint nuevo (`functions/api/internal/capability-bridge.js`, v0.0.9.9). El codigo del endpoint ya esta completo -- falta conectarlo a los adaptadores edge y probarlo contra una cuenta real.
8. Publicar `docs/architecture/licensing-boundaries.md` de forma visible desde el README. -- HECHO en v0.0.9.4 (PR #15).
9. Implementar `D1PluginRegistryStore` y `SqlitePluginRegistryStore` (v0.0.9.9 solo agrego la interfaz + InMemoryPluginRegistryStore; v0.0.9.10 conecto `functions/admin/permissions/index.js` al registro real, pero sigue sin persistencia -- ver `store-factory.ts`); agregar UI de trustScore en el Centro de Permisos.
