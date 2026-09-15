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

**Catálogo de subjects sembrado, no dinámico**: hoy la lista de plugins que
aparecen en el Centro (`hello-plugin`, `commerce-plugin`) está hardcodeada
en `functions/admin/permissions/index.js` (`KNOWN_SUBJECTS`), tomada de los
manifiestos reales que existen en el repo. Todavía no hay un registro de
"plugins instalados en este sitio" persistente del que derivar esta lista
dinámicamente -- agregar un plugin nuevo requiere sumarlo a mano a esa
constante hasta que exista ese registro.

## Limitaciones honestas que quedan pendientes

- La UI (`permission-center-ui.ts`) genera DOM directo, sin framework,
  para poder incrustarse en cualquier panel (ver integración como
  organismo del dashboard en `packages/dashboard`).
- No hay todavía un registro de auditoría de cambios de permisos más allá
  del campo `grantedBy`/`grantedAt` por concesión individual (se sobrescribe
  en cada `setGrant`, no se guarda historial).
- **Bug preexistente encontrado en este PR, no corregido (fuera de alcance):**
  `packages/atomic-elements/src/persistence/store-factory.ts` (usado por
  `createPageStore`, ya en producción) espera el binding como `env.PORTALESS_DB`,
  mientras que `wrangler.toml`, `packages/auth/src/store-factory.ts` y este
  mismo `packages/permissions/src/store-factory.ts` usan `env.DB`. En una
  instancia real de Cloudflare Pages con solo el binding `DB` configurado
  (como documenta `wrangler.toml`), `PageStore` nunca vería D1 y caería
  siempre a SQLite. No se toca aquí porque está fuera del alcance acordado
  para esta ronda (solo Centro de Permisos) -- queda anotado en
  `ROADMAP.md` como tarea manual pendiente.
- El Trust Layer / ledger de agentes (la otra mitad de esta línea del
  README) sigue exactamente igual que antes: `createUsageLedgerStore()`
  existe con las mismas 2 implementaciones reales (D1/SQLite), pero ningún
  endpoint del repo lo invoca todavía. Queda fuera de esta ronda, ver
  ROADMAP.md.
