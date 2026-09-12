# Cómo crear un skin nuevo para el Dashboard de Portaless

Un skin es **solo un archivo JSON**. No requiere escribir componentes,
CSS ni tocar el motor de renderizado. Ver `Portaless_Skin_System.md` en la
raíz del proyecto para el diseño completo detrás de este sistema.

## Pasos

1. Copia `src/skins/base.json` (o cualquier skin existente) como punto de
   partida, o crea uno nuevo declarando `"extends": "base"`.
2. En `layout`, referencia solo organismos que ya existan en
   `src/organisms/registry.ts` (`TrafficChartPanel`, `AgentLedgerPanel`,
   `ContentListPanel`, `CommerceOrdersPanel`, `CommerceRevenuePanel`,
   `PolicyPanel`).
3. Para cada organismo, define:
   - `w` / `h`: ancho/alto en unidades de la grilla.
   - `order`: orden visual (menor = aparece antes).
   - `hidden: true`: si tu skin no necesita ese organismo (ej. una tienda
     no necesita `PolicyPanel` si no usa el Trust Layer).
   - `priority: "high"`: sugiere al renderer destacar visualmente ese
     organismo (uso reservado para futuras versiones con más de un tamaño
     de énfasis).
4. Ajusta `tokens.accent` / `tokens.accent2` para el color de identidad de
   tu skin. El resto de los átomos los heredan automáticamente.
5. Registra tu skin en el `StaticSkinSource` (o en el loader de archivos
   estáticos, según cómo lo integres) y ya puedes seleccionarlo desde el
   selector de skins del panel.

## Qué NO se puede hacer en un skin (por diseño, no por limitación técnica)

- No se puede introducir un organismo nuevo — eso requiere agregar un
  componente al `registry.ts` (una contribución al código de Portaless,
  no del skin).
- No se puede sobrescribir CSS libremente — solo los tokens definidos en
  `DesignTokens`. Esto es intencional: evita que un skin mal hecho rompa
  la usabilidad del panel, el mismo problema que sí puede ocurrir con un
  theme de WordPress.

## Ejemplo mínimo

```json
{
  "skin": "mi-skin",
  "extends": "base",
  "tokens": { "accent": "#ff5a5f" },
  "layout": [
    { "organism": "ContentListPanel", "w": 4, "h": 2, "order": 1 },
    { "organism": "CommerceOrdersPanel", "hidden": true },
    { "organism": "CommerceRevenuePanel", "hidden": true }
  ]
}
```

Esto genera un skin de una sola columna dominante de contenido, ocultando
todo lo relacionado a comercio, en menos de 10 líneas.
