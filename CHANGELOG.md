# Changelog

Todas las versiones notables de Portaless se documentan en este archivo.
Para el estado real y verificado de cada módulo, ver siempre `ROADMAP.md`
y `AGENT.md` -- este changelog es el historial de qué se agregó en cada
versión, no una garantía de que todo lo listado esté libre de TODOs.

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
