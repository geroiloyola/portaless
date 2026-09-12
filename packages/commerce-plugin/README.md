# @portaless/commerce-plugin (manifiesto de referencia)

**Importante**: la lógica real del módulo de comercio de Portaless hoy
vive en `src/commerce/` en la raíz del proyecto Astro (`medusa-client.ts`,
`config.example.ts`), **no en este paquete**.

Este `manifest.json` es una plantilla de referencia que sigue el formato
de capacidades atómicas de `@portaless/plugin-sandbox`
(`content:read`, `network:fetch` con `allowedHosts`, `commerce:read`),
pensada como el primer paso hacia migrar la lógica de `src/commerce/` a
un plugin sandboxeado de verdad, ejecutado bajo el sandbox multi-proveedor
en lugar de código directo dentro del build de Astro.

Ver `docs/architecture/commerce-plugin.md` en la raíz del repo para el
detalle completo de este plan de migración.
