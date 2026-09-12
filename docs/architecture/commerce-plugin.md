# Módulo de Comercio — Estado Real

**Implementado parcialmente**, pero en una ubicación distinta a la
propuesta original. La propuesta original sugería
`packages/commerce-plugin/manifest.json` + `src/`; el código real vive en
`src/commerce/` dentro del proyecto Astro principal (`medusa-client.ts`,
`config.example.ts`, `types.ts`).

## Qué existe hoy

- Cliente de solo lectura contra la Storefront API de Medusa/Mercur.
- Páginas `/tienda` y `/tienda/[handle]` generadas condicionalmente si
  `ENABLE_COMMERCE=true`.
- **No** procesa pagos, carrito ni checkout — por diseño, delega esos
  flujos a la instancia externa de Medusa/Mercur.

## Qué falta para alinear con la propuesta original

Este MVP incluye ahora (adenda post-v0.0.5) un `packages/commerce-plugin/`
con un `manifest.json` de **referencia**, siguiendo el mismo formato de
capacidades atómicas del sandbox de plugins (`content:read`,
`network:fetch` hacia el host de Medusa, etc.), como primer paso hacia
migrar la lógica real desde `src/commerce/` a un plugin sandboxeado de
verdad en una futura versión.
