# Changelog

Todas las versiones notables de Portaless se documentan en este archivo.
Para el estado real y verificado de cada módulo, ver siempre `ROADMAP.md`
y `AGENT.md` -- este changelog es el historial de qué se agregó en cada
versión, no una garantía de que todo lo listado esté libre de TODOs.

## v0.0.9.10 (sin publicar)

### Agregado
- **Testigos externos (ERRATA E-10, spec 5.7)**: `packages/apw-resolver/src/did-apw/witness.ts` (statement `apw-witness+jws` con `jti` determinista, verificacion contra la clave del testigo y evaluacion `head_mismatch` / `equivocation` / `backdated_entry` fail-closed), `POST /admin/api/witness/record` (rol admin; anota la observacion en el historial encadenado del propio testigo) y `GET /.well-known/apw-witnesses.json` (statements publicados, paginados). Vectores V-13 en `APW-VECTORS-v1.3.md`; E-10 integrada en `APW-SPEC-v1.3.md` (nueva seccion 5.7).
- **Anclaje de `h` automatizado (E-10)**: modo `--anchor --domain <d>` en `dnslink/cli.mjs` (baja `did.json` + `apw-log.json` vivos y imprime el TXT v2 listo para pegar, con `buildSiteManifest`), y campo estructurado `anchor: { status, publishedH, localH, localSeq }` en `/admin/api/apw-verification-status` con linea en el checklist del dashboard. El paste del TXT sigue siendo manual (sin API de DNS estandarizada); el calculo, no.
- **Emision automatica de `reader_conduct` (E-9/E-10)**: `scoring/reader-conduct-auto.ts` + indice `scoring/reader-conduct-jti-store.ts` (tabla `reader_conduct_jti`, siembra desde `att_jws` en bases migradas). El middleware del Trust Layer la dispara con `context.waitUntil` tras cada acceso verificado con `readerDid` candidato (throttle 6 h por agente/periodo; opt-out `APW_AUTO_EMIT_CONDUCT=false`). El endpoint admin con step-up queda para backfill y comparte el indice.
- **Licencia y gobernanza de la especificacion (CC BY 4.0)**: seccion nueva `Licencia y gobernanza` en `APW-SPEC-v1.3.md` (licencia del estandar, autor y edicion, nombre, neutralidad y conformidad sin permiso de Portaless, proceso de cambios: errata -> version -> propuestas). Lineas de licencia en `ERRATA.md` y `APW-VECTORS-v1.3.md`, fila de la especificacion en `docs/architecture/licensing-boundaries.md`, y notas en `README.md` y `docs/protocol-apw/README.md`. La licencia del estandar no contamina al codigo AGPL-3.0 ni viceversa.
- **Nombre neutral de la seccion 6**: ahora **Loyal Trust Protocol (LTP)**, antes "Loyola Trust Protocol" (mismo acronimo y misma especificacion, nota de continuidad en la seccion Licencia y gobernanza). Afecta a la spec v1.3 y a `docs/architecture/site-trust-score.md`; los documentos historicos (v1.0, v1.2, whitepaper) quedan con el nombre con que se publicaron, y el credito de autor se conserva en el encabezado y el Anexo A.
- **`schema.sql` maestro regenerado (v0.0.9.31)**: ahora incluye `usage_ledger.reader_did` (ERRATA E-9, ya estaba en su fuente de paquete; el maestro estaba atrasado) y la tabla nueva `reader_conduct_jti` (spec APW 6.4, indice de jti ya emitidos, DDL en `packages/apw-resolver/schema.sql`). Regeneracion idempotente, aplicada dos veces seguidas contra SQLite sin errores (25 tablas). Las bases existentes siguen recibiendo ambos cambios al vuelo desde sus stores, sin reaplicar el archivo.
- **Excepcion por lector de la gobernanza de lectura (spec APW 6.5, cierra E-8)**: el Centro de Permisos admite el subject `reader` (el `did:apw:` de un lector) y la capacidad nueva `trust:read-governance-bypass` (`packages/permissions/src/reader-bypass.ts` + catalogo en `capability-registry.ts`; un plugin no puede solicitarla en su manifiesto). `GET /trust/:siteId` consulta el grant y, con politica activa, salta los umbrales de reputacion con `evaluatePolicy(..., { bypass: true })`. El bypass no salta la identidad APW (6.3) ni valida una politica corrupta, y si el store de grants no se puede leer no se aplica. Alta y revocacion desde `/admin/permissions` (el PUT responde `400 invalid_reader_grant` con un DID mal formado o con cualquier otra capacidad para un subject `reader`), con formulario de DID en el Centro de Permisos.
- **Claves no activas del lector aceptadas dentro de su ventana (spec APW 6.3)**: `resolveReaderState()` admite una firma cuya huella no es `k` si `isRetiredReaderKeyUsable()` (`packages/apw-resolver/src/scoring/reader-identity.ts`) confirma que la clave esta en las `keys` de un historial ya verificado contra `k` y `h`, firmo al menos una entrada de la cadena (su huella o `keyId` como `kid`), y su ventana `[validFrom, validTo + RETIRED_READER_KEY_GRACE_MS]` (10 min de gracia del lado de quien verifica) cubre el momento de la request. Si no, sigue `apw_unresolvable: key_not_bound_to_apw`, y el TTL del cache del exito se acota al cierre de la ventana. Nuevo hook opcional `ReaderResolvers.acceptRetiredKey` (por defecto baja el historial con `includeEntries` + `includeKeys`); `resolveApwHistory()` ahora publica `keys` y el `kid` de cada entrada (`history-resolver.ts`). La emision de `reader_conduct` sigue exigiendo `k`: en rollover se lee, no se puntua.
- **Proyeccion de las dimensiones W publicas (spec APW 6.6, cierra E-8 y E-11)**: `GET /trust/:siteId` calcula las dimensiones W del sitio a partir de su snapshot con `scoring/site-dimensions.ts` (mapeo A.2 de categorias a dimensiones, valores A.4.1 — con `escrow_report` 7/2.5/1 — y W-09 derivado de A.5) y las publica siempre en `projection { dimensions, aggregates, governed }` vía `projectTrustView()`. Al rechazar, la proyeccion vive en `public.projection`: `dimensions` solo con el conjunto publico (W-01, W-04, W-06, W-07, W-09) y `aggregates` con puntaje, cantidad y suma de pesos de todas las dimensiones del sitio (`governed: "withheld"`); al permitir, o sin politica activa, todas las dimensiones con `governed: "granted"`. Las filas fuera del modelo (`perceived_trustworthiness`, valores legacy) no puntuan y el fallo del calculo omite la proyeccion sin cambiar la decision de acceso.
- **Override de visibilidad por dimension (spec APW A.6 / 6.6)**: `site_trust_read_policies` gana la columna `public_overrides` (JSON array de dimensiones **gobernadas**, `ALTER TABLE` automatico en bases existentes; un valor corrupto se ignora, que es la direccion segura). El dueno puede volver publica cualquier dimension gobernada sin tocar la politica: `GET /trust/:siteId` lo pasa a `projectTrustView()`, asi que al rechazar un lector `public.projection.dimensions` trae el conjunto publico **mas** el override y el resto del nivel gobernado sigue oculto. `normalizePublicOverrides()` solo acepta dimensiones gobernadas (el nivel publico no se puede "abrir" ni inventar), las ordena y las deduplica.
- **Portaless Index: agregador de testigos local (spec APW 5.7 y seccion 7)**: `packages/apw-resolver/src/did-apw/witness-index.ts` + `witness-index-store.ts` (tablas `witness_observations`, `witness_weights` y `witness_index_subjects`; D1/SQLite/InMemory, creadas al vuelo en bases existentes). `POST /admin/api/index/sync` (rol admin, sin step-up: todo lo que baja y verifica es publico) consulta a un set de hasta 20 testigos configurados, baja sus `/.well-known/apw-witnesses.json` paginados y aplica a cada statement los cuatro verificadores de 5.7 de punta a punta (cadena del testigo verificada, `att === sha256(jws)` anclado en **esa** cadena, firma contra la clave del testigo, `jti` determinista; ademas `iss`/`sub` esperados y sin self-witness). Guarda la ultima observacion anclada por (sujeto, testigo, seq) — una ancla menor nunca pisa a la mayor — la evalua contra la cadena viva del sujeto (`head_mismatch` / `equivocation` / `backdated_entry`, margen 300 s) y cachea la entrada de directorio con su `status` y un `consensus` ponderado por peso estatico por testigo (default 1.0). El directorio se publica como documento plano re-verificable en `GET /.well-known/apw-index.json` (`{ typ: "apw-index", iss, generatedAt, subjects[] }`) y `GET /admin/api/index/subjects` lo lista para el admin. `resolveApwHistory()` ahora expone `entryHash` por entrada (el hash que observan los testigos). Fuera de alcance documentado en la spec 5.7 y 7: calibracion de pesos estilo A.4.4, gossip/sincronizacion entre nodos indice y agregacion de manifiestos/SiteTrustScore de otras instancias. Tests: `apw-witness-index.test.ts` (17, con claves y statements firmados reales), `apw-witness-index-store.test.ts` (10) y `apw-index-endpoints.test.ts` (10).

### Corregido
- `scripts/generate-schema.mjs` estaba desactualizado respecto del propio `schema.sql` maestro (v0.0.9.4 vs v0.0.9.27): solo conocia 4 fuentes, regenerar habria borrado 17 de las 24 tablas existentes, y sus addendums ya no coincidian con el maestro. Reescrito con las 13 fuentes reales en orden; las secciones sin `schema.sql` de paquete (password reset, plugins, site trust, allowlists, capability bridge, deployment) ahora viven en `schema-additions/*.sql` como fuentes editables, asi el maestro vuelve a ser 100% generado. Regeneracion verificada por diff: solo cambian las notas del encabezado, `reader_did` y `reader_conduct_jti`.
- `README.md` enlazaba `./LICENSE` (badge y seccion License) pero el archivo no existia en el repositorio. Agregado el texto oficial de AGPL-3.0.
- `dnslink/cli.mjs` importaba `../manifest.js`, un archivo inexistente: el CLI no corría. Ahora importa `.ts` y se ejecuta con `tsx` como el resto de los scripts.
- El middleware del Trust Layer no registraba en el ledger los accesos con politica `allow`: solo veia bloqueados y cobrados. Ahora el trafico libre tambien alimenta el ledger publico y la emision de `reader_conduct`.
- Confirmado que el campo de clave publica en `/admin/authorized-escrow-providers` **ya esta implementado** (`a1e0a57`, PR del panel de escrow): el store tiene `public_key_jwk` + `setPublicKey()` (carga, reemplaza y quita sin rotar la API key, rechazando JWK con `d`), el endpoint acepta `publicKeyJwk` en el `POST` y tiene un `PUT` dedicado, la pagina lo ofrece en el alta y en un panel aparte con validacion en navegador y servidor, y `escrow-report.js` exige la clave para verificar el JWS. El ROADMAP lo seguia listando como pendiente ("hoy solo via API o CLI") por informacion desactualizada, no por un faltante.
- **`scripts/generate-schema.mjs` destruia el schema.sql maestro si se lo corria**: el propio CHANGELOG documentaba un rewrite "con las 13 fuentes reales" que **nunca se commiteo** -- el script en HEAD seguia siendo el de v0.0.9.4 (solo 4 paquetes + addendum), asi que `npm run generate-schema` regeneraba un maestro con 8 tablas y borraba 20 de las 28 (authorization, plugins, site trust, apw-resolver, capability bridge, deployment). Reescrito con las 13 secciones reales en orden (5 `schema.sql` de paquete + 8 `schema-additions/*.sql`; `settlement-activations.sql` sigue fuera a proposito, como ya decia el header), el bloque de NOTAs del maestro ahora vive dentro del generador, y la regeneracion quedo verificada: 28/28 tablas identicas, SQLite aplicado limpio y diff contra el maestro committeado solo de comentarios. De paso se cerraron dos desincronizaciones reales que el rewrite tapaba: `reader_conduct_jti` existia en el maestro pero **nunca llego** a `packages/apw-resolver/schema.sql` pese a que el CHANGELOG afirmaba que si (agregada ahi, su fuente real), y la prosa de diseno de la seccion apw-resolver vivia solo en el maestro (movida al schema del paquete).

### Documentado
- **R-05 en politicas sigue apagada y el motivo es de datos, no de config (spec 6.5, ERRATA E-9)**: `policyDimensions["R-05"]` se dejo en `false` despues de medirlo, no por costumbre. R-05 del sujeto es la calibracion de las atestaciones que **el** emitio (A.4.4), pero `loadReaderConduct()` solo trae las que **recibio** (descarta `iss` igual al DID del lector), asi que hasta un lector con tres emisores calibrables y de acuerdo queda con `R-05 = { score: 4.0, count: 0, weightSum: 0 }`: con `min_r05_weight = 2.0` la politica lo rechazaria a el y a todos los demas. Faltan (1) un flujo en que el lector emita atestaciones sobre sujetos (hoy solo existe el voto community anonimo por IP, sin DID) y (2) un corpus de otros emisores sobre el mismo (sujeto, dimension) para el consenso leave-one-out de A.4.4 — indices o testigos (seccion 7). El bloqueo queda anclado como regresion en `tests/unit/apw-reader-conduct-config.test.ts` (nunca encender el flag sin resolver eso), y documentado en la spec 6.5 y 7 y en ERRATA E-9.
- **Las tres categorias de `reader_conduct` de la spec 6.4 siguen sin regla y por dato, no por codigo**: `rate_respected` (R-02), `paid_as_agreed` (R-03) y `redistribution` (R-04) no se emiten porque el ledger no les aporta el dato. `LedgerConductInput` es literalmente lo que escribe `log-writer.ts` (`requestsTotal`, `policyViolationsDetected`) y el middleware registra `charged: false` en los cuatro caminos: `requests_charged` y `revenue_usd` no se mueven nunca, porque con Cloudflare Pay Per Crawl (in-band) el origen devuelve 200 + `crawler-price` y la cobranza se liquida fuera. Emitir `paid_as_agreed` de ahi seria inventar el pago. Cada una queda anclada con su prerequisito: una tasa en la politica de contenido con su contador, un settlement que informe el resultado, y testigos o denuncia para lo que el origen no observa. Regresion en `tests/unit/apw-reader-conduct-config.test.ts`, detalle en `CONDUCT_RULES`, spec 6.4/7 y ERRATA E-9.

## v0.0.9.9 (sin publicar oficialmente, PR #21 abierto)

### Agregado
- **Ecosistema de plugins abierto+cerrado con `trustScore` comunitario** (avance parcial): `packages/plugin-sandbox/src/registry/plugin-registry.ts` con la interfaz `PluginRegistryStore` y `InMemoryPluginRegistryStore` de referencia. Tablas `plugin_registry` y `plugin_trust_votes` en `schema.sql`. Diseño inspirado en Shopify App Store / WooCommerce.org / Android Play Store: catálogo abierto por defecto, confianza regulada por voto comunitario (1-5), no por certificación de Portaless.
- **Endpoint HTTP interno real del `CapabilityHostBridge`**: `functions/api/internal/capability-bridge.js` valida `Authorization: Bearer <PORTALESS_INTERNAL_BRIDGE_TOKEN>`, consulta `PermissionStore` real, y despacha `content:read`/`content:write` a `PageStore` real (las 9 capacidades restantes responden 501 explícito, mismo principio `NOT_CONFIGURED` que `node-isolated-vm.ts`).
- `ROADMAP.md` reorganizado en 3 categorías por responsabilidad: Producción, Internas en Desarrollo, Externas.

### Corregido
- Confirmado que `layout.title`/`layout.description` en `src/pages/paginas/[slug].astro` ya no requieren cast defensivo (`PageLayout` los declara correctamente) -- este roadmap lo marcaba como pendiente por información desactualizada, no por un problema real.
- Confirmado que `functions/admin/_middleware.js` sí expone `context.data.user` (con `session` como alias) para el guard de permisos server-side -- versiones anteriores del roadmap lo marcaban como "pendiente de verificar" por una limitación temporal de herramientas, no por un bug real.
- Limpieza de tipos en `node-isolated-vm.ts`: se elimina el tipo local extendido `BaseCapabilityHostBridge & {contentRead, contentWrite}`, ahora importa `CapabilityHostBridge` directo desde `../types`. Cambio cosmético, sin impacto funcional.

### Pendiente para cerrar esta línea
- Implementar `D1PluginRegistryStore`/`SqlitePluginRegistryStore` (solo existe la versión en memoria).
- Conectar `functions/admin/permissions/index.js` al registro real en vez del catálogo hardcodeado (`hello-plugin`, `commerce-plugin`).
- UI de `trustScore` en el Centro de Permisos.
- Agregar `PORTALESS_INTERNAL_BRIDGE_TOKEN` a `.env.example` y conectar `bridgeUrl` de los adaptadores edge al endpoint nuevo.

## v0.0.9.7 (PR #19, mergeado a main)

### Agregado
- Persistencia real D1/SQLite para `PasswordResetStore`: `D1PasswordResetStore` y `SqlitePasswordResetStore`, mismo patrón que los stores de usuarios/sesiones, usando la tabla `password_reset_requests` (existente en `schema.sql` desde v0.0.9.4).

## v0.0.9.6 (PR #18, mergeado a main)

### Agregado
- `contentRead`/`contentWrite` agregados a `CapabilityHostBridge` en `types.ts`, completando el patrón de puente real iniciado en v0.0.9.4 para las 12/12 capacidades del catálogo.

## v0.0.9.5 (PR #16, mergeado)

### Corregido
- `functions/admin/login.js` ahora maneja el flujo de 2FA end-to-end: si `result.mfaRequired && result.mfaChallengeToken`, redirige a `/admin/login-mfa?challenge=<token>`. Sin cambios de comportamiento para usuarios sin 2FA activo.
- `ROADMAP.md` actualizado y revisado en busca de código de terceros vendorizado a re-licenciar bajo AGPL-3.0 -- sin hallazgos en el árbol raíz (no sustituye una auditoría legal formal de dependencias npm).

## v0.0.9.4 (PR #13 y #15, mergeados a agentic y luego a main via PR #17)

### Agregado
- **Licenciamiento del proyecto**: `LICENSE` reemplazado por AGPL-3.0 con linking exception para el Plugin SDK; `LICENSE-SDK` (MIT) agregado; `docs/architecture/licensing-boundaries.md` documenta la frontera exacta entre el core AGPL-3.0, el SDK de plugins en MIT, y los proyectos AppPlace/AppLibre/terceros.
- **Recuperación de contraseña, 2FA, OAuth/SSO**: `AuthService` gana `completeMfaLogin`, `beginTotpEnrollment`, `confirmTotpEnrollment`, `disableTotp`, `requestPasswordReset`, `completePasswordReset`, `loginWithOAuth`. 6 endpoints/páginas nuevos, 15 tests.
- **Instalación en un comando**: `schema.sql` (raíz) generado a partir de los `schema.sql` de cada paquete más la tabla de password reset; `scripts/setup.mjs` aplica el schema y crea el admin inicial (`npm run setup`); `scripts/generate-schema.mjs` regenera el maestro si cambia algún paquete. Cloudflare D1 sigue usando `wrangler d1 execute` por separado (documentado, no automatizado).
- **Bridge real de contenido para plugins**: `content:read`/`content:write` integrados al patrón de puente real vía `ivm.Reference`, completando 12/12 capacidades del catálogo con puente real (las 9 capacidades previas ya lo tenían desde v0.0.9).
- `README.md` con nueva sección "Novedades recientes" y "Licenciamiento"; badge de licencia actualizado de MIT a AGPL-3.0; tabla "Estado real por módulo" actualizada.
- `package.json` (raíz): versión 0.0.9.4 (antes 0.0.5, desactualizado desde hacía varias versiones); `license` AGPL-3.0-or-later (antes MIT); scripts `setup` y `generate-schema` invocables vía `npm run`.
- `SECURITY.md` corrige 2 afirmaciones desactualizadas: Web Bot Auth sí valida la firma Ed25519 desde v0.0.9 (antes decía que no); Centro de Permisos y ledger del Trust Layer tienen persistencia real desde v0.0.9.2/v0.0.9.3 (antes decía que se perdían al reiniciar). Se agregan notas sobre `PasswordResetStore` solo en memoria (resuelto luego en v0.0.9.7), y el cambio de licencia como nota legal relevante.
- `.env.example` agregado (no existía): documenta todas las variables de entorno, incluyendo el bloque de OAuth/SSO.
- `docs/architecture/authentication.md` reescrito para reflejar 2FA/TOTP, recuperación de contraseña, y OAuth/SSO.

## v0.0.9.3 (PR #12, mergeado a main)

### Agregado
- Ledger del Trust Layer expuesto vía `GET /.well-known/portaless-usage-log.json` (con `?period=YYYY-MM` opcional). Público, sin guard de sesión, mismo criterio de transparencia que `portaless-content-policy.json`. 5 tests nuevos en `tests/unit/usage-log-endpoint.test.ts`.

### Corregido
- Diagnóstico impreciso de versiones anteriores: `functions/_middleware.js` ya llamaba a `recordAgentAccess()` con `createUsageLedgerStore(env)` desde v0.0.6 -- la escritura del ledger sí estaba conectada. Lo que faltaba era la lectura pública, resuelta en esta versión.
- Bug de nombre de binding D1 inconsistente entre factories: `createPageStore` alineado a `env.DB` como las otras 3 factories. Nombres de path SQLite unificados (`PORTALESS_SQLITE_PATH`).

## v0.0.9.2 (PR #11, mergeado a main)

### Agregado
- Centro de Permisos conectado a persistencia real end-to-end: endpoint `functions/admin/permissions/index.js` (GET snapshot con seed de subjects conocidos + defaults no concedidos, PUT otorga/revoca con guard server-side `canWrite(role)==="admin"`). UI (`permission-center-ui.ts`) reescrita para que el único camino de escritura sea `onToggle`. Nueva página `src/pages/admin/permissions.astro`. 9 tests nuevos en `tests/unit/admin-permissions-role-check.test.ts`.

### Corregido
- Se documenta que la línea "Persistencia real Permisos + Trust Layer" marcada `[x]` en v0.0.6 era imprecisa: solo se habían creado los stores D1/SQLite, sin que ningún endpoint los invocara.

## v0.0.9.1 (PR #10, mergeado a main junto con v0.0.9.2)

### Agregado
- Integración real con las APIs REST públicas de Cloudflare Workers for Platforms y Deno Deploy (subida/creación + invocación). **No verificado end-to-end contra una cuenta real** -- cubierto por tests con `fetch` mockeado. Deno Deploy mapea `network:fetch` a allowlist de host; Cloudflare sube/actualiza scripts vía PUT con nombre determinístico por `name@version`.

## v0.0.9 (PR #8 y #9, mergeados a agentic y luego a main)

### Agregado
- Puentes de capacidades reales en `isolated-vm`: 9 capacidades nuevas (`storage:read/write`, `email:send`, `commerce:read/checkout`, `media:read/write`, `agent:identify`, `site:admin`) cruzan al isolate vía `ivm.Reference.apply({result:{promise:true}})`, sumadas a `network:fetch` (ya existía) = 10/12 con puente real.
- Cache del directorio de claves Web Bot Auth y verificación de unicidad de nonce contra replay (`tests/unit/webbotauth-verify.test.ts`).
- Pool de isolates reutilizables para `commerce-plugin`: `poolMaxIsolates` en `NodeIsolatedVmAdapter`, con aislamiento real de Context por ejecución aunque el isolate subyacente se reutilice.
- Reordenamiento por arrastre dentro de un mismo slot de columnas en Atomic Elements: lógica extraída a `packages/atomic-elements/src/editor/tree-ops.ts` (funciones puras, testeadas sin DOM).
- Verificación criptográfica real de Web Bot Auth (RFC 9421, Ed25519).

## v0.0.8 (PR #6 y #7, mergeados a agentic y luego a main)

### Agregado
- SEO/GEO nativo: imports de `JsonLd` + `SeoHead` conectados en `src/pages/paginas/[slug].astro`, usando los helpers de `src/lib/seo.ts` (`getSiteUrl`, `buildCanonicalUrl`).
- Persistencia real de páginas: `D1PageStore` y `SqlitePageStore` en `packages/atomic-elements/src/persistence/stores/`, más `store-factory.ts`, cumpliendo la interfaz `PageStore` ya existente (`load`/`save`/`list`) para mantener compatibilidad con `LocalStoragePageStore` del editor cliente. `GET`/`PUT` en `functions/admin/pages/[slug].js` usan `createPageStore(env)` en vez de placeholders.
- `canWrite(role)` aplicado a todo el dashboard: guard DOM-level + validación server-side en `functions/admin/pages/[slug].js` y `functions/admin/permissions/index.js`.

---

## v0.0.5

### Agregado
- **`packages/plugin-sandbox/`**: sandboxing de plugins multi-proveedor.
  - `types.ts`: contrato `SandboxAdapter`, capacidades atómicas
    (`CapabilityId`), manifiesto de plugin.
  - `capabilities/capability-registry.ts`: catálogo de 12 capacidades
    atómicas agrupadas por categoría (Contenido, Red, Comercio,
    Almacenamiento, Agentes IA, Administración).
  - `adapters/`: `CloudflareWorkersForPlatformsAdapter`,
    `DenoDeployAdapter`, `FastlyComputeAdapter`, `NodeIsolatedVmAdapter`
    (self-hosted) + `AdapterRegistry` para resolver el primero disponible.
  - `manifest/`: validación y carga de manifiestos de plugin.
  - `runtime/sandbox-runtime.ts`: motor central — siempre usa lo
    **concedido** por el administrador, nunca lo **solicitado** por el
    plugin.
  - Advertencia de seguridad documentada sobre CVE real de `isolated-vm`
    (GHSA-864f-rcv7-6rh4), con verificación de versión segura en el
    constructor del adaptador self-hosted.
- **`packages/permissions/`**: Centro de Permisos atómico estilo
  iOS/Android.
  - `permission-catalog` (vía `capability-registry` compartido),
    `permission-store.ts`, `permission-center-ui.ts`.
  - `public/permissions/index.html`: demo standalone abrible directo en
    el navegador.
- **Actualizado**: `packages/dashboard/src/organisms/registry.ts` — nuevo
  organismo `PermissionsCenterPanel` que resume permisos de alto riesgo
  directamente en el dashboard.

### Notas de esta versión
- Los cuatro adaptadores de sandboxing son esqueletos con arquitectura
  completa, pero sin integración real contra la API de cada proveedor
  (`TODO` explícito) — no usar como sandboxing activo en producción todavía.
  Nota histórica (corregida en v0.0.6): el adaptador `isolated-vm`
  self-hosted pasó a ejecutar código real en la versión siguiente.
- `InMemoryPermissionStore` no persiste entre despliegues; para producción
  usar un backend real (Git, KV, SQLite). Nota histórica (corregida en
  v0.0.9.2): el Centro de Permisos tiene persistencia real end-to-end
  desde esta versión.
- El sistema es deliberadamente multi-proveedor: un sitio puede correr
  100% self-hosted (isolated-vm) sin depender de Cloudflare, Deno Deploy
  ni Fastly.
