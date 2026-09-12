
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
- `InMemoryPermissionStore` no persiste entre despliegues; para producción
  usar un backend real (Git, KV, SQLite).
- El sistema es deliberadamente multi-proveedor: un sitio puede correr
  100% self-hosted (isolated-vm) sin depender de Cloudflare, Deno Deploy
  ni Fastly.
