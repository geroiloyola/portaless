# Contribuir a Portaless

Gracias por tu interés en contribuir. Portaless es un proyecto joven
(v0.0.x, en fase de MVP) — la mayoría de los módulos son esqueletos
funcionales con puntos de integración marcados explícitamente como `TODO`.
Antes de contribuir, lee el `CHANGELOG.md` para entender qué está
realmente implementado y qué es todavía diseño.

## Cómo contribuir

1. Abre un Issue antes de un PR grande, para alinear el enfoque.
2. Todo módulo nuevo debe seguir el principio de "opcional, no
   obligatorio" — activar un módulo (comercio, Trust Layer, sandboxing)
   nunca debe romper el comportamiento del sitio si está desactivado.
3. Cualquier `TODO` que resuelvas debe venir acompañado de un test en
   `tests/unit/` o `tests/e2e/`.
4. Los plugins deben declarar sus capacidades en un manifiesto — nunca
   agregues acceso implícito a red, almacenamiento o datos de usuarios.
5. El núcleo de Portaless se licencia bajo AGPL-3.0. El Plugin SDK
   (`packages/plugin-sdk`) se licencia aparte bajo MIT, para no
   restringir a los plugins de terceros que lo consuman. Ver
   `docs/architecture/licensing-boundaries.md` para la frontera exacta
   antes de contribuir código nuevo a cualquiera de los dos.

## Áreas donde más se necesita ayuda hoy

- Completar la integración real de los adaptadores de sandboxing edge
  (`packages/plugin-sandbox/src/adapters/deno-deploy.ts` y
  `cloudflare-workers-for-platforms.ts`) contra cuentas reales de
  prueba -- hoy solo verificados con `fetch` mockeado. El adaptador
  `isolated-vm` self-hosted ya ejecuta código real desde v0.0.6.
- Implementar `D1PluginRegistryStore` y `SqlitePluginRegistryStore`
  para el registro de plugins con `trustScore` comunitario (v0.0.9.9
  solo agregó la interfaz y la versión en memoria).
- MCP server, identidad AT Protocol y Protocol APW resolver: estos
  paquetes son stubs — ver `docs/architecture/` para el estado real de
  cada uno antes de empezar a implementar.
- Probar `npm run setup` localmente contra un archivo SQLite real antes
  de confiar en el flujo de instalación documentado en
  `scripts/SETUP.md`.

## Código de conducta

Sé respetuoso, específico en tus reportes de bugs, y honesto sobre
limitaciones cuando propongas una feature — este proyecto prioriza
documentar claramente lo que no funciona todavía sobre aparentar que
todo está resuelto.
