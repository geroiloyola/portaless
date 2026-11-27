# Idioma del panel y plantillas del wizard (E6)

## Hecho verificado

El panel de administración está en español. Ejemplos con archivo:línea:

- `src/pages/admin/index.astro:64` — título “Panel de administración”.
- `src/pages/admin/index.astro:174` — tarjeta “Páginas”.
- `src/pages/admin/index.astro:204` — tarjeta “Publicar sitio”.
- `src/pages/admin/pages.astro:25` — “Páginas”.
- `src/pages/admin/pages.astro:232` — “Publicar” / “Hacer privada”.
- `src/pages/admin/publish.astro:28` — “Publicar revisiones aprobadas”.
- `src/pages/admin/editor.astro:52` — “Publicar”.
- `src/pages/admin/editor.astro:285-288` — “Guardar privado”, “Guardar borrador”, “Guardar y publicar”.
- `src/pages/admin/settings/email.astro:82`, `analytics.astro:64`, `appearance.astro:61` — “Guardar”.

Las plantillas del wizard generan contenido en español, no en inglés:

- `packages/onboarding/src/intent-to-layout.ts:86` — “Mis trabajos”.
- `:88` — “Disponible para encargos y colaboraciones…”.
- `:99` — “Productos destacados”.
- `:107` — “Mis enlaces”.
- `:126` — párrafo con la intención del usuario.
- `:127` y `:129` — “Contactanos” / “Enviar mensaje”.
- `:109-115` — enlaces `https://instagram.com/` y `https://tiktok.com/@` como placeholders.

## Conflicto con D10

D10 decide que el starter es solo en inglés. El panel y las plantillas del wizard siguen en español; el starter no debe publicar copy en español por defecto.

## Opciones

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| A) Traducir todo el panel a inglés en PR-B2 | Coherencia con starter | Cambio grande y fuera del alcance del starter | No |
| B) i18n del panel con locale (es/en) en un PR aparte | Coherencia y conserva español | Trabajo de extracción de strings y tests | Recomendada después de PR-B2 |
| C) Dejar el panel en español y documentarlo | Cero trabajo | Mezcla visible para usuarios ingleses | Aceptable temporalmente |

## Recomendación

- No traducir el panel en PR-B2. Mantenerlo en español y documentar que el starter público es inglés.
- En PR-B2, hacer que las plantillas del wizard reciban el locale del starter: copy en inglés para `starter`, español para `demo`.
- Abrir un PR de i18n del panel después de PR-B2 si el dueño lo autoriza. No cambiar comportamiento ahora.

## No verificado

No se midió el uso real por audiencia inglesa ni se probó un locale de panel; no hay mecanismo de locale de admin hoy.
