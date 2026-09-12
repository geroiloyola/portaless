# Mapa de Estructura: Propuesta Original vs. Implementación Real

Este documento existe para que nadie pierda tiempo buscando código en la
ubicación "correcta" según la propuesta inicial de estructura de
repositorio, cuando la implementación real tomó otro camino por razones
técnicas concretas.

| Ruta propuesta originalmente | Ubicación real | Razón de la diferencia |
|---|---|---|
| `packages/core/` | Raíz del repo (`src/`, `astro.config.mjs`) | Astro (y su tooling de build, Vite) espera su código fuente en la raíz del proyecto por convención; envolverlo en `packages/core/` habría exigido configuración adicional sin beneficio real para un proyecto de un solo sitio. |
| `packages/core/src/sandbox/` | `packages/plugin-sandbox/` | Se nombró explícitamente por su función (sandboxing multi-proveedor) en vez de anidarlo bajo "core", ya que es un paquete independiente reutilizable por cualquier instalación de Portaless. |
| `packages/core/src/admin/` | `packages/dashboard/` | Mismo criterio: el panel de administración es un paquete propio con su propio ciclo de versión (Skin System), no una subcarpeta del core. |
| `packages/core/wrangler.jsonc` | `wrangler.toml` (raíz) | Formato TOML usado en la configuración inicial del proyecto; `.jsonc` es igualmente válido para Wrangler, pero no se migró por no aportar beneficio funcional. |
| `packages/commerce-plugin/` | `src/commerce/` (implementación real) + `packages/commerce-plugin/manifest.json` (referencia, agregado en esta adenda) | El módulo de comercio se construyó primero como parte del sitio Astro principal, antes de que existiera el formato de manifiesto de capacidades del sandbox de plugins. Migrar la lógica real a un plugin sandboxeado queda como trabajo pendiente. |

## Paquetes que sí siguen la estructura propuesta, sin cambios

- `packages/mcp-server/`, `packages/identity-atproto/`,
  `packages/apw-resolver/`: existen ahora como stubs con la estructura de
  carpetas exacta propuesta originalmente, pero sin lógica implementada
  — ver los documentos correspondientes en `docs/architecture/` para el
  estado real de cada uno.
- `plugins-registry/`, `examples/`, `infra/`, `.github/`, `tests/`: se
  agregaron en esta adenda siguiendo exactamente la estructura original.

## Recomendación

No forzar una migración de `src/` hacia `packages/core/` solo para calzar
con la propuesta inicial — el costo de reescribir todas las rutas de
importación de v0.0.1 a v0.0.5 no se justifica frente al beneficio
(ninguno funcional, solo estético). Si en el futuro Portaless soporta
múltiples sitios desde un mismo monorepo, ahí sí conviene revisar esta
decisión.
