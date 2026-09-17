# Centro de Permisos de Portaless

Control atómico -- "cosa por cosa" -- de qué puede hacer cada plugin, tema
o agente de IA dentro de un sitio Portaless, inspirado deliberadamente en
la pantalla de Privacidad y Seguridad de iOS/Android, no en el modelo
"todo o nada" de activar/desactivar un plugin completo.

## Principio de diseño

En iOS, no le das "acceso total al teléfono" a una app: le das acceso a
la Cámara, o a Contactos, o a Ubicación, cada uno por separado, y puedes
revocar cualquiera sin desinstalar la app. El Centro de Permisos de
Portaless aplica exactamente esa misma lógica a los plugins: un plugin de
comercio puede tener concedido `commerce:read` pero **no**
`network:fetch`, y seguirá funcionando parcialmente (o fallando de forma
controlada) en vez de tener acceso total o ninguno.

## Cómo se conecta con el sandbox de plugins

Este paquete es la interfaz de administración; `@portaless/plugin-sandbox`
es quien realmente hace cumplir lo que aquí se configura. El puente es
`createPermissionResolver()` en `permission-store.ts`, que expone las
concesiones de este Centro como un `PermissionResolver` que el
`SandboxRuntime` consulta antes de cada ejecución de un plugin — **la
concesión del administrador siempre gana sobre lo que el plugin
solicitó** en su manifiesto.

## Categorías de permisos (igual que iOS agrupa Cámara/Micrófono/Contactos)

- **Contenido**: leer/escribir páginas, posts y medios.
- **Red**: conexión a servicios externos (siempre con hosts explícitos),
  envío de correo.
- **Comercio**: lectura de catálogo, inicio de checkout.
- **Almacenamiento**: lectura/escritura del espacio propio del plugin.
- **Agentes IA**: lectura del ledger del Trust Layer.
- **Administración**: cambios de configuración global (el nivel de riesgo
  más alto, mostrado explícitamente en rojo en la interfaz).

## Persistencia real (v0.0.9.2)

`createPermissionStore()` (`store-factory.ts`) elige entre `D1PermissionStore`
(Cloudflare Pages, binding `env.DB`) y `SqlitePermissionStore` (self-hosted,
`env.PORTALESS_SQLITE_PATH`), cayendo a `InMemoryPermissionStore` solo si
ninguno de los dos está disponible. El endpoint server-side
`functions/admin/permissions/index.js` (GET lee el snapshot completo, PUT
otorga/revoca un grant puntual) es quien la conecta -- valida sesión y
aplica `canWrite(role) === "admin"` del lado del servidor, mismo patrón que
`functions/admin/pages/[slug].js`. La página `src/pages/admin/permissions.astro`
monta `renderPermissionCenter()` contra ese endpoint via `fetch`, con estado
de carga, guardado y error visibles.

**Catálogo de subjects ya es dinámico (v0.0.9.10), pero aún no persistente**:
`functions/admin/permissions/index.js` ya no hardcodea `hello-plugin` ni
`commerce-plugin` en una constante -- deriva el catálogo llamando a
`createPluginRegistryStore(env).list(false)`
(`packages/plugin-sandbox/src/registry/store-factory.ts`), que a su vez usa
el registro real agregado en el PR #21
(`packages/plugin-sandbox/src/registry/plugin-registry.ts`). Agregar un
plugin nuevo ya no requiere editar el endpoint: basta con `register()` en
el store. **Limitación que sigue pendiente**: el único backend hoy es
`InMemoryPluginRegistryStore`, seedeado con `hello-plugin`/`commerce-plugin`
en `store-factory.ts` -- el registro se resetea a ese seed en cada
despliegue o reinicio, hasta que se implemente `D1PluginRegistryStore` o
`SqlitePluginRegistryStore` (ver `ROADMAP.md`).

## Limitaciones honestas que quedan pendientes

- La UI (`permission-center-ui.ts`) genera DOM directo, sin framework,
  para poder incrustarse en cualquier panel (ver integración como
  organismo del dashboard en `packages/dashboard`).
- No hay todavía un registro de auditoría de cambios de permisos más allá
  del campo `grantedBy`/`grantedAt` por concesión individual (se sobrescribe
  en cada `setGrant`, no se guarda historial).
- **Actualización v0.0.9.3**: el bug de binding D1 inconsistente que se
  había encontrado y documentado aquí (`env.PORTALESS_DB` en
  `atomic-elements/persistence/store-factory.ts` vs `env.DB` en esta
  factory) ya se corrigió -- las 4 factories del repo (auth, permissions,
  trust-layer, atomic-elements) usan ahora `env.DB` de forma consistente.
  Ver `ROADMAP.md` para el detalle del fix.
- **Actualización v0.0.9.3**: el Trust Layer / ledger de agentes (la otra
  mitad de la línea de estado del README) también quedó conectado --
  resultó que su lado de ESCRITURA ya estaba conectado desde v0.0.6
  (`functions/_middleware.js` llamaba a `recordAgentAccess` con D1/SQLite
  reales), solo faltaba un endpoint de LECTURA. Se agregó
  `functions/.well-known/portaless-usage-log.json.js`. Ver
  `packages/trust-layer/docs/TRUST_LAYER_SETUP.md` y `ROADMAP.md`.
