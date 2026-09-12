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
5. Todo el código se licencia bajo MIT, igual que el resto del proyecto.

## Áreas donde más se necesita ayuda hoy

- Completar la integración real de los adaptadores de sandboxing
  (`packages/plugin-sandbox/src/adapters/*.ts`), hoy con `TODO` explícito.
- Persistencia real del Centro de Permisos y del ledger del Trust Layer
  (hoy en memoria).
- El editor visual Atomic Elements: undo/redo y anidamiento visual en
  columnas.
- MCP server, identidad AT Protocol y Protocol APW resolver: estos
  paquetes son stubs — ver `docs/architecture/` para el estado real de
  cada uno antes de empezar a implementar.

## Código de conducta

Sé respetuoso, específico en tus reportes de bugs, y honesto sobre
limitaciones cuando propongas una feature — este proyecto prioriza
documentar claramente lo que no funciona todavía sobre aparentar que
todo está resuelto.
