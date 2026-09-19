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
- [x] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5, mergeado). Aclaracion (esta sesion): esto aplica al motor de renderizado real (`renderHTMLAsync()` en `packages/atomic-elements/src/elements/registry.ts`, que llama a `fetchProducts()` contra Medusa/Mercur). El `ProductGrid` dentro del EDITOR VISUAL de Atomic Elements sigue siendo un placeholder visual -- ver linea nueva en "Funcionalidades Internas en Desarrollo".
- [x] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5, mergeado)
- [x] Licenciamiento del proyecto: separar Portaless (core) bajo AGPL-3.0 con SDK de plugins bajo MIT -- v0.0.9.4 (PR #13, mergeado). LICENSE reemplazado por AGPL-3.0 + linking exception para el Plugin SDK; LICENSE-SDK (MIT) agregado; docs/architecture/licensing-boundaries.md documenta la frontera exacta entre el core AGPL-3.0, el SDK de plugins en MIT, y los proyectos AppPlace/AppLibre/terceros.
- [x] Recuperacion de contrasena, 2FA, OAuth/SSO -- v0.0.9.4 (PR #15, mergeado a agentic, luego a main via PR #17). AuthService gano completeMfaLogin, beginTotpEnrollment, confirmTotpEnrollment, disableTotp, requestPasswordReset, completePasswordReset, loginWithOAuth. 6 endpoints/paginas nuevos, 15 tests.
- [x] functions/admin/login.js maneja el flujo de 2FA end-to-end -- v0.0.9.5 (PR #16, mergeado). Si result.mfaRequired && result.mfaChallengeToken, redirige a /admin/login-mfa?challenge=<token>. Sin cambios de comportamiento para usuarios sin 2FA activo.
- [x] SEO/GEO nativo -- v0.0.8: imports de JsonLd + SeoHead conectados en src/pages/paginas/[slug].astro, usando los helpers de src/lib/seo.ts (getSiteUrl, buildCanonicalUrl). Ver docs/architecture/seo-geo.md.
- [x] Campos title/description de PageLayout en src/pages/paginas/[slug].astro -- CONFIRMADO ya resuelto (v0.0.8): el archivo real accede directamente a `layout.title`/`layout.description` sin cast defensivo, con un comentario inline explicito que dice "types.ts SI declara title (obligatorio) y description (opcional) en PageLayout, por lo que ya no hace falta el cast defensivo". Este roadmap lo marcaba como pendiente en versiones anteriores por informacion desactualizada, no por un problema real en el codigo -- corregido en v0.0.9.9 tras revisar el archivo completo.
- [x] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519) - mergeado. Ver tambien la seccion nueva "SiteTrustScore" mas abajo -- esta verificacion es la base de identidad de la fuente `agent` del score.
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
- [x] Registro dinamico de plugins con trustScore comunitario -- CERRADO end-to-end esta sesion (v0.0.9.9 a v0.0.9.11 + UI de trustScore). `packages/plugin-sandbox/src/registry/plugin-registry.ts` (interfaz `PluginRegistryStore`), `store-factory.ts` (`createPluginRegistryStore(env)`: `env.DB` (D1) -> `env.PORTALESS_SQLITE_PATH` (SQLite) -> memoria), `D1PluginRegistryStore`/`SqlitePluginRegistryStore` con persistencia real (el registro ya no se resetea en cada despliegue), `functions/admin/permissions/index.js` deriva su catalogo del registro real (no de una lista hardcodeada), y `permission-center-ui.ts` ya renderiza `buildTrustBadge()` (5 estrellas con relleno parcial via clip-path, escala 0-10, color dinamico por rango) en el Centro de Permisos. Nota de proceso: el PR que consolido esto (#28) llego a fusionarse tras pasar por revision -- verificar siempre el estado real de un PR (`state`/`merged`) antes de asumirlo cerrado solo porque el trabajo de codigo esta completo.
- [x] MCP server conectado end-to-end -- esta sesion (commits `738d65332` y `9e0510004` en la rama `mcp-server-sync`, consolidados a `main` via la rama intermedia `fixes-main`, PR #35). `createPortalessMcpServer()` antes solo creaba el `McpServer` base y lo retornaba vacio -- ninguna de las tools con codigo real en `src/tools/` se registraba. Ahora conecta las 6 tools reales (`list_page_components`, `query_usage_log`, `list_installed_plugins`, `create_page`, `update_page`, `grant_capability`, `revoke_permission`) a traves de `requireCapability()` por tool. `index.ts` (nuevo) resuelve `AgentIdentity` desde `MCP_AGENT_KEY` (obligatoria) y construye los stores reales (`PageStore`/`PermissionStore` via sus store-factory; `PluginRegistryStore` solo en memoria todavia, sin factory D1/SQLite propia; `UsageLedgerStore` como stub minimo get/increment). **LIMITACION EXPLICITA (Opcion A, no B)**: `AgentIdentity` se resuelve una sola vez por proceso, no por invocacion -- el SDK de MCP no expone hoy sesion por llamada sobre `StdioServerTransport`. Ver "Funcionalidades Internas en Desarrollo" para la Opcion B.
- [x] Atomic Elements: 4 `ElementType` nuevos para paginas "link en bio" -- esta sesion (rama `atomic-elements-design`, PR #34, consolidado via `fixes-main`). `LinkList`, `SocialIcons`, `ProfileHeader`, `StoreBlock` agregados a `ElementType` (`packages/atomic-elements/src/types.ts`), con `ElementDefinition` real en `elementRegistry`/`elementPalette`, y aceptados por las tools `create_page`/`update_page` del MCP server (el `z.enum` de `elementNodeSchema.type` se extendio para no rechazar estos 4 tipos). Ver `docs/architecture/creator-sites-agentic-workflow.md`.
- [x] SiteTrustScore -- las 4 fuentes (self, agent, community, escrow_report) tienen endpoint HTTP conectado -- esta sesion (rama `agentic`, commits `9c39ce1a0`, `f13cf3ee`, `d8e6ffd2`, `4154a4ebe`, `a6c356da5`). Diseño: `packages/trust-layer/src/site-trust/site-trust-score.ts` (dominio separado de `PluginRegistryStore`, que califica plugins, no sitios completos); 5 tablas nuevas en `schema.sql` (`site_trust_subjects` + una por fuente). Verificacion de identidad via `web-bot-auth.ts` (paquete oficial de Cloudflare, cache de JWKS via KV, TTL 6h) + `authorized_agents`/`authorized_escrow_providers` como allowlist de AUTORIZACION (identidad valida no es lo mismo que permiso -- distincion de status code 401 vs 403). Endpoints: `functions/trust/[siteId]/agent-verification.js` y `.../escrow-report.js` (API key hasheada SHA-256, entrega manual fuera de banda, sin autoservicio). **Limitacion que persiste**: `agent` y `escrow_report` no tienen UI de escritura ni datos reales todavia -- ambas allowlists estan vacias por defecto, alta manual sin flujo automatico. Ver docs/architecture/site-trust-score.md.

---

## Funcionalidades Internas en Desarrollo

Lo que falta, pero es responsabilidad exclusiva de Portaless resolver -- no depende de ningun proveedor externo, tercero, ni proyecto aparte.

- [ ] Probar `npm run setup` localmente contra un archivo SQLite real antes de confiar en el flujo de instalacion documentado en scripts/SETUP.md. Requiere ejecucion manual con Node y `better-sqlite3` instalado; ninguna herramienta disponible en las sesiones de trabajo hasta ahora tiene un shell de Node conectado al repo real para hacerlo. Verificacion manual del propietario del proyecto.
- [ ] Identidad AT Protocol
- [~] Protocol APW resolver real -- HOY: STUB, no implementado. `packages/apw-resolver/README.md` declara explicitamente "STUB -- no implementado", con solo la estructura de carpetas prevista (`src/dns-txt/`, `src/dnslink/`, `src/did-apw/`) sin logica. Ver seccion nueva "Portaless Public: descubrimiento y confianza entre sitios" mas abajo para el desglose de tareas concretas.
- [ ] MCP server: identidad de agente por invocacion (Opcion B) -- HOY: `AgentIdentity` es fija por proceso (Opcion A, via `MCP_AGENT_KEY`), no verificada por invocacion, porque el SDK de MCP no expone sesion por llamada sobre `StdioServerTransport`. Bloqueante para cualquier escenario donde una misma instancia deba distinguir entre multiples agentes/usuarios de forma segura. Documentado como riesgo de seguridad activo en `AGENT.md`.
- [ ] `PluginRegistryStore` dentro del MCP server sin factory D1/SQLite propia -- HOY: `index.ts` del mcp-server solo instancia `InMemoryPluginRegistryStore` (unica implementacion disponible en ese punto de entrada), a diferencia del endpoint admin (`functions/admin/permissions/index.js`) que ya usa `createPluginRegistryStore(env)` con D1/SQLite reales. Sin esto, el catalogo de plugins que un agente ve via `list_installed_plugins` se resetea entre procesos si no hay persistencia configurada en ese punto de entrada especifico.
- [ ] `UsageLedgerStore` del MCP server como stub minimo -- HOY: `index.ts` construye un stub get/increment, no el ledger real de `trust-layer`. Conectar el ledger real queda fuera de alcance del commit que conecto las 6 tools (documentado inline como TODO explicito).
- [ ] `ProductGrid` del editor visual de Atomic Elements sigue siendo un placeholder -- distinto del `ProductGrid` de renderizado real (`renderHTMLAsync()`), que SI consulta Medusa/Mercur (ver linea movida a "Funcionalidades en Produccion"). El editor (`packages/atomic-elements/docs/ATOMIC_ELEMENTS.md`) documenta esto como pendiente para una proxima version -- el admin que arma la pagina en el editor no ve todavia los productos reales que el sitio publicado si muestra.
- [~] Ecosistema de plugins abierto+cerrado con trustScore comunitario -- CERRADO end-to-end esta sesion, ver linea movida a "Funcionalidades en Produccion". Se mantiene aqui unicamente la vision de largo plazo, ver seccion "Ecosistema de plugins" mas abajo.
- [~] Endpoint HTTP interno real que exponga `CapabilityHostBridge` sobre HTTP (`bridgeUrl`, ya definido en `SandboxExecutionInput` desde v0.0.9.1) -- v0.0.9.9, codigo completo en `functions/api/internal/capability-bridge.js`: valida `Authorization: Bearer <PORTALESS_INTERNAL_BRIDGE_TOKEN>`, consulta `PermissionStore` real para verificar la concesion, y despacha `content:read`/`content:write` a `PageStore` real (las 9 capacidades restantes responden 501 explicito, mismo principio NOT_CONFIGURED que `node-isolated-vm.ts`). **Pendiente para cerrar esta linea**: (1) agregar `PORTALESS_INTERNAL_BRIDGE_TOKEN` a `.env.example`; (2) modificar `deno-deploy.ts` y `cloudflare-workers-for-platforms.ts` para que apunten `bridgeUrl` a este endpoint; (3) prueba real contra una cuenta de Cloudflare/Deno (ver "Funciones Externas" -- ese ultimo paso depende de un proveedor externo, el resto es responsabilidad interna).
- [ ] Confirmar los nombres exactos de los campos title/description en packages/atomic-elements/src/types.ts (PageLayout) -- CERRADO, ver linea movida a "Funcionalidades en Produccion" arriba.
- [ ] Crypto-agilidad post-cuantica para `authorized_agents` -- Ed25519 (usado hoy por Web Bot Auth, RFC 9421) es criptografia de curva eliptica clasica, vulnerable al algoritmo de Shor en una computadora cuantica suficientemente potente. NIST ya finalizo el reemplazo estandarizado (FIPS 204, ML-DSA, 13 de agosto de 2024, mismo estatus legal que AES/SHA-2) -- no es una apuesta a un algoritmo futuro sin definir. v0.0.9.24 agrego la columna `key_algorithm` (default `"ed25519"`) a `authorized_agents` en ambos backends (D1/SQLite) y a `schema.sql`, mas el flag `--key-algorithm` en `scripts/onboard-agent.mjs` -- esto NO implementa verificacion ML-DSA todavia (`web-bot-auth.ts` sigue verificando solo Ed25519), solo deja el esquema listo para no requerir una migracion de datos con filas reales ya en produccion en sitios de terceros el dia que se implemente el segundo algoritmo. Ver docs/architecture/site-trust-score.md, seccion "Crypto-agilidad". **Limitacion honesta adicional**: `schema.sql` (usado para D1) no se actualizo en el mismo commit que agrego la columna a SQLite -- no se pudo verificar su contenido exacto con las herramientas disponibles en esa sesion, y editarlo sin verlo arriesgaba corromper el esquema real. `D1AuthorizedAgentsStore` sigue funcionando (lee columnas por nombre), pero la fila que D1 inserte no tendra `key_algorithm` hasta que se actualice `schema.sql` a mano.
- [ ] SiteTrustScore -- UI de alta para `authorized_agents` y flujo de onboarding para proveedores de `escrow_report` mas alla de la entrega manual de API key. Ver desglose completo en la seccion nueva "Portaless Public" mas abajo.

---

## Funciones Externas

Lo que depende de un tercero -- otra empresa, otro proveedor de nube, u otro proyecto open source -- para completarse. Portaless expone el protocolo, el SDK, o el contrato tecnico necesario, pero la pieza en si se construye y se mantiene fuera de este repositorio.

- [ ] Cobro real Pay per Crawl -- ver nota de alcance abajo, seccion "Trust Layer y Pay per Crawl: protocolo abierto, no asegurador". Ver tambien "Portaless Public: settlement por consulta al conocimiento" mas abajo -- el `settlement-adapter.ts` ya tiene la interfaz correcta, con AI Crawl Control de Cloudflare como unico backend previsto, todavia sin conectar ("Integracion pendiente" es la respuesta real del adaptador hoy).
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

**Lo que si aporta Portaless**: un `trustScore` publico y transparente (promedio de votos 1-5 de la comunidad, visible antes de conceder cualquier capacidad desde el Centro de Permisos, con UI ya implementada -- ver "Funcionalidades en Produccion") para que la propia comunidad regule la confianza -- exactamente el mismo principio que las resenas de Play Store o los ratings de WooCommerce.org, pero calculado de forma abierta (`plugin_trust_votes` es una tabla consultable, no un numero opaco). Para plugins de codigo cerrado, el campo `auditedBy` permite registrar que una entidad externa (por ejemplo, el futuro AppPlace) revizo el plugin -- informativo, nunca una certificacion de Portaless.

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

## Portaless Public: descubrimiento y confianza entre sitios

Seccion nueva (esta sesion). Cubre exclusivamente instancias en infraestructura sin costo obligatorio (GitHub Pages, Cloudflare Pages) o self-host propio del creador -- el hosting es una variable de costo intercambiable elegida por cada creador, no afecta este diseño. Lo que si importa es la capa de confianza que permite que el contenido de miles de instancias independientes se pueda verificar, descubrir, y eventualmente agregar, sin que Portaless tenga que hostear, custodiar ni controlar ninguno de esos sitios.

Estado real de las 3 piezas que sostienen esta capa, confirmado en esta sesion:

| Pieza | Estado real |
|---|---|
| Web Bot Auth (identidad criptografica por sitio, RFC 9421/Ed25519) | Implementado y con tests |
| SiteTrustScore -- 4 fuentes (self, agent, community, escrow_report) | Las 4 fuentes tienen endpoint HTTP conectado. `agent` y `escrow_report` sin UI de escritura ni datos reales -- allowlists vacias, alta manual |
| Protocol APW (descubrimiento via DNS TXT `_apw.tudominio.com`) | STUB -- solo especificacion en `docs/protocol-apw/apw-spec.md`, sin logica en `packages/apw-resolver/` |

**Tareas -- Protocol APW (sacar de estado stub):**
- [ ] Implementar `packages/apw-resolver/src/dns-txt/`: lectura real de registros TXT bajo `_apw.tudominio.com` (limite practico ~512 bytes por registro sin forzar TCP, ya documentado en `apw-spec.md`). Bloqueante para todo lo demas en esta seccion.
- [ ] Definir el formato del payload que cada sitio publica en su TXT record: como minimo `siteId`, referencia a su `SiteTrustScore` publico (`/trust/:siteId`), y un resumen de `contentKinds` (campo ya existente en `SiteInfo`, ver `creator-sites-agentic-workflow.md`).
- [ ] Escribir el lado de publicacion (`dnslink`, ya previsto en la estructura de carpetas) para generar el TXT record sin editar DNS a mano -- CLI o script, no UI todavia.
- [ ] Tests de resolucion contra un dominio de prueba real (no mock), mismo estandar de honestidad que `web-bot-auth.test.ts`.

**Tareas -- SiteTrustScore (completar las 2 fuentes sin datos reales):**
- [ ] UI de alta para `authorized_agents` (hoy: allowlist vacia, alta manual sin interfaz).
- [ ] Flujo de onboarding de proveedores de `escrow_report` mas alla de la entrega manual de API key fuera de banda (decision deliberada como Fase 1, por ser la señal mas objetiva/ground truth) -- sin un segundo proveedor real registrado, el score no puede probarse con mas de una fuente objetiva.
- [ ] Documentar publicamente como se calculan los pesos entre las 4 fuentes, para que el score sea auditable por cualquiera, no solo por quien lee el codigo.

**Tareas -- Portaless Index (extension nueva, no existe ni como stub):**
- [ ] Especificar el formato de manifiesto que un sitio publica para ser indexable (reutilizando el mismo TXT record de Protocol APW, no un mecanismo nuevo aparte).
- [ ] Diseñar la capa de permiso "que puede consultar un tercero externo y en que condiciones" -- distinta del `PermissionGrant` actual (pensado para plugins y agentes administrativos, no para consultas de terceros al contenido publicado). El creador decide que se expone: publico libre, con atribucion, o via settlement pago.
- [ ] Definir el mecanismo de agregacion (crawler ligero o agente de IA) que lee manifiestos + SiteTrustScore de multiples instancias sin almacenar el contenido en si, solo metadatos y enlaces -- ningun GB de hosting adicional a cargo de Portaless.
- [ ] Evaluar una capa de "procedencia" (que fraccion del contenido cita fuentes verificables o fue escrito por una identidad de agente ya auditada en el ledger del Trust Layer) antes de tratar el voto comunitario simple como suficiente para contenido factual agregado entre sitios independientes.

**Tareas -- Settlement por consulta al conocimiento (adapter ya existe, sin backend real):**
- [ ] Conectar `packages/trust-layer/src/billing/settlement-adapter.ts` contra un backend real. Hoy el unico camino previsto (AI Crawl Control de Cloudflare) devuelve "Integracion pendiente" -- es un placeholder con la interfaz correcta, no una integracion rota. El creador del sitio cobra directamente a quien consulta su conocimiento; Portaless no intermedia el dinero (mismo principio que "Trust Layer y Pay per Crawl" ya establece arriba).
- [ ] Definir que valores de `transactionOutcome` aplican a consultas de conocimiento (hoy los 3 valores validos estan pensados para `escrow_report` de comercio -- revisar si aplican igual o necesitan su propio enum).

**Ejemplos ya implementables hoy, sin ninguna tarea pendiente de esta seccion**, usando piezas ya confirmadas como funcionales en runtime gratuito (GitHub Pages o Cloudflare Pages):
1. Pagina personal / link-en-bio con identidad verificable: los 4 `ElementType` nuevos (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`) + Web Bot Auth activo desde el primer despliegue. Un agente con acceso al MCP server puede crear la pagina completa via `create_page` hoy mismo.
2. Landing page de un solo producto/proyecto en Cloudflare Pages, con `Hero`, `Columns`, `ProductGrid` (version de renderizado real conectada a Medusa/Mercur) y SEO/GEO nativo (`buildJsonLd()`, funcional desde v0.0.8).
3. Micrositio con Trust Layer publico visible: cualquier instancia desplegada hoy ya expone `/trust/:siteId` con lectura publica activa desde v0.0.9.3.
4. Sitio de creador con panel de administracion propio, operado via agente de IA (MCP server) sin tocar el editor visual de Atomic Elements -- coherente con la tesis de "el agente es la interfaz principal", aprovechando que Autenticacion y Centro de Permisos ya son funcionales end-to-end.

---

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
| #21 | feat/v0.0.9.9-plugin-ecosystem -> main | Mergeado (via #28) | Limpieza de tipos en node-isolated-vm.ts, registro dinamico de plugins con trustScore comunitario, endpoint HTTP interno de CapabilityHostBridge, ROADMAP.md actualizado |
| #28 | agentic -> main | Mergeado | Ecosistema de plugins: registro dinamico, persistencia D1/SQLite, UI de trustScore -- cierra el pendiente parcial del PR #21 |
| #33 | mcp-server-sync -> fixes-main | Mergeado | Conecta las 6 tools reales del MCP server a createPortalessMcpServer(); fix de import faltante; ElementType nuevos aceptados en create_page/update_page |
| #34 | atomic-elements-design -> fixes-main | Mergeado | Incorpora los 4 ElementType de link-en-bio (LinkList, SocialIcons, ProfileHeader, StoreBlock) |
| #35 | fixes-main -> main | Mergeado | Consolida mcp-server-sync + atomic-elements-design en main; AGENT.md actualizado con el estado real del MCP server |
| #36 | main -> agentic | Mergeado | Sincroniza agentic con los cambios de main (mcp-server conectado, Atomic Elements link-en-bio) antes de esta actualizacion de ROADMAP.md |

## Tareas manuales pendientes

1. Probar `npm run setup` localmente contra un archivo SQLite real antes de confiar en el flujo de instalacion documentado en scripts/SETUP.md. Requiere ejecucion manual con Node y `better-sqlite3` instalado; ninguna herramienta disponible en las sesiones de trabajo hasta ahora tiene un shell de Node conectado al repo real para hacerlo. Verificacion manual del propietario del proyecto.
2. Si se agregan nuevos endpoints de escritura al dashboard (permisos, configuracion, etc.), replicar el patron de canWrite(role) de functions/admin/pages/[slug].js.
3. Commitear un package-lock.json real a la raiz para poder reactivar cache: npm en los workflows de CI. -- HECHO en PR #8.
4. Revisar y, si aplica, re-licenciar bajo AGPL-3.0 cualquier codigo de terceros vendorizado o dependencia embebida directamente en el arbol del repo -- REVISADO en v0.0.9.5: sin vendor/third_party en el arbol raiz; infra/ es config propia de despliegue; plugins-registry/ solo tiene un README. Sin hallazgos, no sustituye una auditoria legal formal de las dependencias de npm.
5. Probar `DenoDeployAdapter` y `CloudflareWorkersForPlatformsAdapter` (v0.0.9.1) contra cuentas reales de prueba -- solo estan verificados con `fetch` mockeado. En espera de credenciales, sin fecha estimada.
6. Desplegar el Worker "dispatcher" fijo que requiere `CloudflareWorkersForPlatformsAdapter`. Fuera de alcance hasta contar con cuenta real.
7. Agregar `PORTALESS_INTERNAL_BRIDGE_TOKEN` a `.env.example`, y modificar `deno-deploy.ts`/`cloudflare-workers-for-platforms.ts` para que apunten `bridgeUrl` al endpoint nuevo (`functions/api/internal/capability-bridge.js`, v0.0.9.9). El codigo del endpoint ya esta completo -- falta conectarlo a los adaptadores edge y probarlo contra una cuenta real.
8. Publicar `docs/architecture/licensing-boundaries.md` de forma visible desde el README. -- HECHO en v0.0.9.4 (PR #15).
9. Agregar UI de trustScore en el Centro de Permisos -- HECHO esta sesion (`buildTrustBadge()` en `permission-center-ui.ts`, ver "Funcionalidades en Produccion").
10. Confirmar si `.github/workflows/ci.yml` ejecuta `npm test` -- señalado como no confirmado en `docs/architecture/site-trust-score.md` durante esta sesion; no bloqueante para los commits que lo mencionan, pero pendiente de verificacion manual antes de asumir que cualquier PR reciente paso CI en verde solo porque el PR quedo abierto sin errores visibles.
11. Implementar `packages/apw-resolver/src/dns-txt/` (Protocol APW real) -- ver desglose completo en la seccion nueva "Portaless Public: descubrimiento y confianza entre sitios".
12. UI de alta para `authorized_agents` y flujo de onboarding de proveedores de `escrow_report` -- ver misma seccion nueva.
13. Conectar `packages/trust-layer/src/billing/settlement-adapter.ts` contra un backend real (AI Crawl Control de Cloudflare es el unico previsto hoy) -- ver misma seccion nueva.
14. Dar a `PluginRegistryStore` del MCP server (`index.ts`) una factory D1/SQLite propia, en vez de solo `InMemoryPluginRegistryStore` -- hoy el endpoint admin ya tiene persistencia real, pero el punto de entrada del mcp-server no.
