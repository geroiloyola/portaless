
## v0.0.4

### Agregado
- **Atomic Elements** (`packages/atomic-elements/`): editor visual de
  páginas por arrastrar-y-soltar. Catálogo de 8 elementos (`Hero`,
  `Heading`, `Paragraph`, `Image`, `Button`, `Columns`, `ProductGrid`,
  `Spacer`) en `elements/registry.ts`, cada uno con `renderHTML()` puro
  (sin dependencia de DOM), permitiendo usar el mismo motor tanto en el
  editor (navegador) como en el build estático de Astro (Node).
- `src/render.ts`: motor de renderizado compartido — lo que ves en el
  editor es exactamente lo que se publica, sin paso de traducción.
- `src/persistence/`: esquema de validación de páginas
  (`page-schema.ts`) y almacenamiento pluggable (`page-store.ts`,
  implementación de referencia sobre `localStorage`).
- `src/editor/`: `drag-drop.ts` (HTML5 DnD sin librerías externas),
  `property-panel.ts` (panel de propiedades generado automáticamente desde
  `editableProps` de cada elemento), `editor-app.ts` (bootstrap completo
  del editor).
- `astro-integration/PageRenderer.astro`: conecta el `PageLayout` producido
  por el editor con el build estático real de Astro.
- `src/pages/paginas/[slug].astro` + `src/content/pages/*.json`: ruta
  dinámica que publica cualquier página creada con Atomic Elements.
- `public/editor/index.html`: **demo standalone en JavaScript plano**,
  funcionalmente equivalente al paquete TypeScript — se puede abrir
  directamente en el navegador sin instalar nada ni correr un build.

### Notas de esta versión
- El `ProductGrid` es un placeholder visual; la conexión real con el
  catálogo de Medusa/Mercur queda pendiente para una próxima versión.
- No hay anidamiento de elementos dentro de `Columns` desde la interfaz
  visual todavía (sí es posible editando el JSON a mano).
- No hay undo/redo.
- `LocalStoragePageStore` es solo para desarrollo — un sitio en producción
  debe persistir las páginas como archivos en el propio repositorio Git.
