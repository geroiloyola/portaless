# Plugins Registry

Directorio de manifiestos públicos de plugins verificados para Portaless.
Cada plugin listado aquí debe:

1. Publicar su `manifest.json` siguiendo el esquema de
   `@portaless/plugin-sandbox` (capacidades atómicas declaradas
   explícitamente, con `reason` legible para cada una).
2. Pasar la validación de `validateManifest()` antes de ser aceptado.
3. Declarar qué adaptador(es) de sandboxing soporta (Cloudflare Workers
   for Platforms, Deno Deploy, Fastly Compute, o `isolated-vm`
   self-hosted).

**Estado actual: vacío.** Este es un directorio de referencia para cuando
exista un primer plugin de terceros real — hoy Portaless solo incluye el
módulo de comercio (`packages/commerce-plugin/`) como manifiesto de
ejemplo, todavía no migrado a este flujo de registro público.
