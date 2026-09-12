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

## Limitaciones honestas de este MVP

- `InMemoryPermissionStore` no persiste entre despliegues -- para
  producción, implementar `PermissionStore` sobre un archivo versionado en
  Git o una base de datos real.
- La UI (`permission-center-ui.ts`) genera DOM directo, sin framework,
  para poder incrustarse en cualquier panel (ver integración como
  organismo del dashboard en `packages/dashboard`).
- No hay todavía un registro de auditoría de cambios de permisos más allá
  del campo `grantedBy`/`grantedAt` por concesión individual.
