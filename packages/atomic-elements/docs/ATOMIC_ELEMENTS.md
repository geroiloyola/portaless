# Atomic Elements — Editor Visual de Portaless (v0.0.4)

Editor de arrastrar-y-soltar para construir páginas, portales y catálogos
de tienda, sin escribir código. Ver `Portaless_Skin_System.md` para el
diseño hermano de este sistema (aplicado al dashboard admin en vez de a
páginas de contenido).

## Probarlo ahora, sin instalar nada

Abre `public/editor/index.html` directamente en tu navegador. Es una
versión standalone en JavaScript plano, funcionalmente equivalente al
paquete TypeScript real (`packages/atomic-elements/`), pensada para poder
probar el editor de inmediato sin paso de build.

## Por qué es más rápido que Elementor (comparación concreta)

| | Elementor | Atomic Elements |
|---|---|---|
| CSS/JS cargado por página | 200–600 KB, incluye widgets no usados | Solo el HTML/CSS inline de los elementos efectivamente usados |
| Profundidad de DOM por elemento | 8–20 `<div>` anidados | 1 nodo raíz por elemento (ver `renderHTML` en `elements/registry.ts`) |
| Librería de iconos | Font Awesome completo (~70KB) siempre cargado | Emoji/glifos inline, cero peso adicional |
| Formato de salida | HTML+CSS generado y mezclado con el motor de WordPress | JSON declarativo (`PageLayout`), renderizado 1:1 a HTML estático en build |

## Cómo se integra con el resto de Portaless

1. El editor (navegador) produce un `PageLayout` (JSON) — ver `src/types.ts`.
2. Ese mismo JSON se guarda como archivo en `src/content/pages/*.json`.
3. La ruta `src/pages/paginas/[slug].astro` lo lee en build time y lo pasa a
   `PageRenderer.astro`, que llama a `renderPage()` — **el mismo motor que
   usa el editor en el navegador** — para generar el HTML final estático.

No existe un paso de "traducción" entre lo que ves en el editor y lo que
se publica: es literalmente el mismo código de renderizado ejecutándose en
dos entornos (navegador para preview, Node/Astro para el build de
producción).

## Elementos disponibles en esta versión

`Hero`, `Heading`, `Paragraph`, `Image`, `Button`, `Columns`, `ProductGrid`
(placeholder — pendiente de conectar con `packages/commerce` en una
próxima versión), `Spacer`.

## Limitaciones honestas de este MVP

- El reordenamiento por drag & drop solo soporta niveles simples; anidar
  elementos dentro de `Columns` desde la interfaz visual todavía no está
  implementado (sí es posible haciéndolo a mano en el JSON, ver el ejemplo
  en `src/content/pages/ejemplo-atomic-elements.json`).
- No hay deshacer/rehacer (`undo`/`redo`) todavía.
- El `ProductGrid` es un placeholder visual — la conexión real con el
  catálogo de Medusa/Mercur del módulo de comercio queda pendiente para
  la próxima versión.
- `LocalStoragePageStore` es solo para desarrollo/demo. Un sitio real debe
  implementar `PageStore` contra el propio repositorio Git (un archivo por
  página), manteniendo el principio de "todo es texto versionable".
