# Cómo crear un skin nuevo para el Dashboard de Portaless

Un skin es **solo un archivo JSON con tokens de diseño**. No requiere
escribir componentes, CSS, ni tocar ningún motor de renderizado. El skin
gobierna color y tipografía del panel — **no** su estructura: el dashboard
es HTML propio (`src/pages/admin/index.astro`) y los skins aportan el
theme, no el layout.

> Nota (Fase 10): hasta v0.0.9.x un skin también declaraba un `layout` de
> "organismos" (paneles tipo gridPos) que el motor de skins renderizaba.
> Ese sistema **nunca se usó en producción** y se retiró por honestidad: los
> paneles eran datos mock. Hoy un skin es únicamente un preset de tokens con
> herencia.

## Pasos

1. Copia `src/skins/base.json` (o cualquier skin existente) como punto de
   partida, o crea uno nuevo declarando `"extends": "base"`.
2. Ajusta `tokens.accent` / `tokens.accent2` / `tokens.accentText` para el
   color de identidad de tu skin. El resto de los átomos los heredan
   automáticamente. `accentText` es la variante del accent legible COMO
   TEXTO sobre fondos claros (el lima oficial `#C5D86D` no alcanza
   contraste AA como texto sobre `#F7F7F2`).
3. Registra el nombre del skin en `SKIN_NAMES` y su manifiesto en
   `SKIN_MANIFESTS` (`src/skin-engine/site-skin-store.ts`) y ya aparece en
   el selector de `/admin/appearance` (el panel escribe la fila `site_skin`
   y el sitio público, el dashboard y el editor lo leen vía la hoja
   `GET /api/site-skin`).

## Qué NO se puede hacer en un skin (por diseño, no por limitación técnica)

- No se puede cambiar la estructura del panel: eso es código del dashboard,
  no del skin.
- No se puede sobrescribir CSS libremente — solo los tokens definidos en
  `DesignTokens`. Esto es intencional: evita que un skin mal hecho rompa
  la usabilidad del panel, el mismo problema que sí puede ocurrir con un
  theme de WordPress.

## Ejemplo mínimo

```json
{
  "skin": "mi-skin",
  "extends": "base",
  "tokens": { "accent": "#ff5a5f" }
}
```

Esto genera un skin con un acento propio, heredando todo lo demás de
`base`, en una línea.
