# Patrón de enlaces para contenido ficticio (E2)

Análisis de `tests/unit/demo-pages-links.test.ts` y propuesta para el perfil demo. Sin implementar.

## Qué prohíbe el test actual

- `example.com` y subdominios (`tests/unit/demo-pages-links.test.ts:59`).
- `portaless.com` y subdominios (`tests/unit/demo-pages-links.test.ts:60`).
- Raíz pelada de plataformas (`instagram.com/`, `youtube.com/`, `open.spotify.com/`, `music.apple.com/`, `bandcamp.com/`, `tiktok.com/@`) (`tests/unit/demo-pages-links.test.ts:28-35`, `:61-63`).
- `http://` sin TLS (`tests/unit/demo-pages-links.test.ts:58`).
- URLs que no parsean (`tests/unit/demo-pages-links.test.ts:51-56`).

No prohíbe `example.org`, `placehold.co` ni rutas internas. No escanea `packages/onboarding`; solo `src/content/pages/*.json`.

## Patrón propuesto para el perfil demo

1. **CTAs internas primero.** Usar `/pages/<demo-slug>/`, `/blog/<id>/`, `/shop/` o anclas `#contacto`. El test las acepta (`tests/unit/demo-pages-links.test.ts:46`).
2. **Sociales ficticias.** Usar `https://example.org/portaless-demo/<caso>/<red>` para los iconos sociales. Es un dominio reservado, resuelve a una página de ejemplo de IANA y no representa una cuenta real. No usar `instagram.com/`, `tiktok.com/@` ni raíces de plataformas.
3. **Afiliados.** Retirar etiquetas de afiliado y enlaces externos de compra. Usar `ProductCard` con URL interna `/shop/` o sin URL externa. No usar `rel="sponsored"` en la demo.
4. **Imágenes.** Usar `https://placehold.co/...` para avatares/placeholders o imágenes con licencia verificada y atribución en el inventario de PR-B1. Sin fotos de personas reales.
5. **Etiqueta visible.** Cada página demo muestra “Demo content, fictional”.

## Por qué no debilita el test

El test existente no se modifica. El patrón elige destinos que ya cumplen sus reglas. Para PR-B2 se propone **añadir** un test específico del perfil demo:

- todos los enlaces externos son `example.org` o un allowlist documentado;
- no aparece ninguna plataforma social real;
- no hay `rel="sponsored"` ni etiquetas de afiliado;
- las imágenes tienen licencia declarada.

## Riesgo abierto

Las plantillas del wizard (`packages/onboarding/src/intent-to-layout.ts:109-115`) siguen generando `https://instagram.com/` y `https://tiktok.com/@` como placeholders. D9 las conserva como opciones, pero no son contenido del perfil demo. Si se usan en el starter, hay que sustituirlas por el patrón anterior.
