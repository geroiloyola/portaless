

## Atomic Elements: editor visual de páginas (nuevo en v0.0.4)

Editor de arrastrar-y-soltar (`packages/atomic-elements/`) para construir
páginas, portadas y catálogos sin escribir código — pensado explícitamente
para ser más liviano que Elementor (sin la profundidad de DOM ni el peso de
CSS/JS de los builders tradicionales de WordPress).

**Pruébalo ahora mismo**: abre `public/editor/index.html` directamente en
tu navegador, sin instalar nada. Arrastra elementos, edítalos, y exporta el
JSON resultante.

Lo que construyes en el editor se guarda como `PageLayout` (JSON) en
`src/content/pages/*.json`, y `src/pages/paginas/[slug].astro` lo convierte
en una página estática real usando exactamente el mismo motor de render que
usa el editor — no hay paso de traducción intermedio.

Ver `packages/atomic-elements/docs/ATOMIC_ELEMENTS.md` para el detalle
técnico completo, incluyendo las limitaciones honestas de este MVP.
