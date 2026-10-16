# Guía de diseño de Portaless

Documenta **el sistema que existe hoy en el código**, no un rediseño propuesto.
Cada afirmación es verificable: los valores viven en los archivos citados y los
tests enumerados al final fijan los contratos. Si esta guía y el código
discrepan, el código manda y esta guía es el bug.

Audiencia: quien vaya a tocar un componente, agregar un token o revisar un PR
de contenido visual.

---

## 1. Paleta oficial

Cinco colores de marca, declarados una sola vez en
`packages/dashboard/src/skin-engine/tokens.ts` (`DEFAULT_TOKENS`) y referenciados
por `global.css` como variables CSS `--*`:

| Rol | Hex | CSS var | Uso |
|---|---|---|---|
| Lima | `#C5D86D` | `--accent` | Fondos de botón sólido, acentos de superficie |
| Oliva | `#5A6B24` | `--accent-text` | El acento **como texto/enlaces** sobre fondos claros (el lima puro no alcanza AA sobre hueso) |
| Naranja | `#F05D23` | `--accent-2` | Acento secundario, énfasis editorial, llamadas |
| Tinta | `#261C15` | `--text` | Texto principal; texto **sobre** lima (botones sólidos) |
| Hueso | `#F7F7F2` | `--bg` | Fondo de página claro |
| Salvia | `#E4E6C3` | `--panel-border` | Bordes de panel (también relleno de `.badge`) |
| Blanco | `#FFFFFF` | `--panel-bg` | Fondo de tarjeta/panel |

Los otros tokens semánticos (`success*`, `warning*`, `danger*`, `muted`,
`radius`, `density`) están en el mismo archivo; `TOKEN_TO_CSS_VAR` es **la**
lista completa (16 claves) y cualquier sistema nuevo debe alinearse con ella
(hay test de paridad).

**Tema oscuro oficial**: `DEFAULT_DARK_TOKENS` (mismo archivo). Tinta como
fondo, hueso como texto, lima conservado como acento. No es un tema «invertido»:
es la paleta oficial reescrita para fondos oscuros.

## 2. Tipografía

- **Fraunces Variable** → display (`h1..h3`, hero): `--font-display`, escala
  `clamp()`, tracking `-0.01em`.
- **Inter Variable** → UI/cuerpo: `--font-sans`, `body { font-family: var(--font-sans) }`.
- **IBM Plex Mono** → datos técnicos (DIDs, hashes, TXT, comandos): `code/kbd/samp/pre`
  en **todas** las páginas, no por página.

Self-hosted en `public/fonts/` con doble `src` (`woff2-variations` + `woff2`),
declarado en `src/styles/fonts.css` (sin petición de red a Google). Los tres
familias comparten `font-family` fallback del sistema.

## 3. Superficies, profundidad y radio por rol

- `--radius: 22px` → superficies (`.card`, paneles).
- `--radius-button: 8px` / `--radius-input: 6px` → controles (nunca píldoras;
  las píldoras quedaron reservadas a badges y switches).
- Sombras `--shadow-sm/md` **teñidas con la tinta** (RGB 38,28,21), nunca gris
  SaaS: la profundidad se lee como la misma materia, no como un overlay.
- `.card` se apoya en `--panel-bg` + borde `--panel-border` y tiene hover-lift;
  todo movimiento va detrás de `prefers-reduced-motion`.
- Los tiempos se centralizan en `--transition-fast` (150 ms).

## 4. Chrome público

- **Header** (`src/components/Header.astro`): marca + índice de publicaciones
  **solo si existe al menos un post publicado** y con la palabra correcta
  (`Publicaciones`/`Posts` desde `src/lib/site-lang.ts`, nunca «Blog»; la URL
  `/blog/` no cambió) + **rincon de acción** a la derecha (ver «Atomic Icons
  Responsive» abajo).
- **Atomic Icons Responsive** (`src/lib/atomic-responsive-icons.ts`): el
  rincon derecho del header es **inteligente y adaptativo**. Share (icono
  iOS: caja + flecha) **siempre**; el icono **principal** se deriva del
  contenido de la página que el visitante está viendo (preorden del árbol
  de elementos, sin configuración manual): `ProductGrid`/`StoreBlock` →
  **carrito** que lleva a `/tienda/`; `Video` → **control de volumen** que
  silencia/des-silencia los iframes embebidos (YouTube vía los comandos
  `postMessage` del IFrame API —el embed lleva `enablejsapi=1`—; Vimeo vía
  su protocolo `method`/`value`, best-effort; el estado se refleja en
  `aria-pressed` y el CSS lo atenúa); `Map` → **icono de cómo llegar**
  (rombo con flecha que navega a `#ae-map` y enlaza a OpenStreetMap
  directions). El HTML sale de **una sola fuente** compartida por el
  header Astro y el shell runtime, y el listener delegado va embebido
  desde el mismo módulo (`VOLUME_LISTENER_SCRIPT`), sin handlers inline.
  Límites honestos: si un player ignora el `postMessage` no cambia nada
  (estado local, sin SDK).
- **Catálogo extensible de elementos**:
  - `Map` (`MapEl`): embed nativo de OpenStreetMap sin trackers de terceros,
    con cálculo de bounding box por nivel de zoom y botón de indicaciones
    «Cómo llegar» a OSRM.
  - `ProductCard`: tarjeta de producto lista para marketing de afiliados
    (`rel="sponsored noopener noreferrer" target="_blank"` para enlaces
    externos como Amazon) o para tiendas internas de Portaless/Medusa.
- **TrustScore & Veraciers** (`/trust/[siteId]`):
  - Ficha de Identidad & Alcance Verificado: País de origen (Chile), Fecha
    histórica de creación (14 Oct 2026), 92 Veraciers (comentarios y
    atestaciones activas en la red), confiabilidad por ámbito (técnica 98%,
    políticas 95%, comunidad 4.9/5, transacciones 100%) y alcance de audiencia
    verificado en Spotify, YouTube (32K+ visitas @jerrybantz), Apple Music,
    Instagram y Facebook.
- **Footer** (`src/components/Footer.astro`), dos filas con trabajos
  distintos: fila ecosistema `TrustScore · Explore · Powered by Portaless`
  (links reales: `/trust/default`, `/explore/`, repo) y, **debajo**, la
  fila de posicionamiento exacta: **`Open Source, Modular, Agent-Ready &
  Zero-Hosting`** (las afirmaciones AGPL/sin-hosting/sin-DB siguen siendo
  ciertas en el repo mismo; el footer las resume en la promesa del
  producto).
- **`/explore`** (`src/pages/explore.astro`): hub de descubrimiento con
  páginas + posts + red, filtrado con `isDraft` canónico de `deploy-engine`.
  Es la costura donde después entra el marketplace (otro repo) sin tocar el footer.
- **Botón compartir** (solo el rincon del header — `ProfileHeader` ya no
  trae botón propio; nunca doble share): `data-portaless-share` con
  **icono iOS** (caja + flecha; `share-2` quedó solo como icono de
  paleta del elemento `SocialIcons`), **sin handlers inline**; el
  listener delegado vive en `BaseLayout` y en el shell runtime
  (Web Share API → clipboard + toast), compatible con una CSP
  futura. Prueba real en navegador: `tests/browser/public-ecosystem-footer.spec.ts`
  (clic real + aserción de un solo share en la página);
  evidencia visual: `docs/screenshots/header-share-button.png` y
  `docs/screenshots/header-actions-{video,shop}.png`.

## 5. Sistema de theming (tres capas)

Esta es la sección central. Las tres capas coexisten y tienen reglas de
precedencia exactas:

### Capa 1 — Skin del sitio (global)

- Fuente: tabla `site_skin`, emisor público `/api/site-skin`
  (`packages/dashboard/src/skin-engine/`).
- Manifests con `extends` (p.ej. `portafolio`, `lanzamiento` sobre `base`) que
  fusionan tokens; admin puede sobreescribir claves de marca en
  `/admin/appearance`.
- Se inyecta como `<link rel="stylesheet">` **después** de `global.css` en el
  head, para poder sobreescribir la paleta por defecto.

### Capa 2 — Toggle del visitante (`data-theme`)

- `localStorage("portaless-theme") = "dark" | "light"` aplicado **antes del
  primer paint** por un script inline en `BaseLayout`.
- Los bloques `@media (prefers-color-scheme: dark)` y `:root[data-theme="dark"]`
  de `global.css` tienen especificidad **(0,2,0)**.

### Capa 3 — Tema por página (theme packs)

- Contrato: `packages/atomic-elements/src/themes/theme-pack.ts`.
- `PageLayout.theme?: string` nombra un pack; el catálogo es
  `BUILTIN_THEMES` (en el repo, presente hasta en build estático) ∪ la tabla
  `theme_packs` (instalados, `availableThemes()` impide que un instalado
  oculte un builtin).
- **Allowlist estricta**: `THEME_VARS` son exactamente las 16 claves de
  `TOKEN_TO_CSS_VAR` (paridad con test). Valores con la misma máscara que
  `isSafeTokenValue` de dashboard. Un pack es JSON validado — **nunca CSS
  libre ni una función** (misma frontera data-only que los element packs).
- **Herencia**: el pack declara solo lo que cambia; el resto de las variables
  siguen del skin de la capa 1. `extends` fusiona packs entre sí con
  detección de ciclos (cadena rota → `null` → fallback total al skin).
- **Emisión** (decisión verificada, no estética): las variables viajan como
  **atributo `style` en `<html>`**, junto a `data-theme-pack="<nombre>"`.
  Motivo: Astro inyecta el `<link>` de `global.css` (con su bloque `@media`
  oscuro de especificidad 0,2,0) **después** del contenido estático del head;
  una regla `:root[data-theme-pack]` perdería el empate por orden en
  sistemas en modo oscuro. Un atributo inline gana a **cualquier** regla de
  hoja, siempre, sin `!important`. Ambos emisores — `BaseLayout.astro` (build)
  y `functions/paginas/[slug].js` (runtime) — hacen lo mismo, con paridad
  fijada por test.
- **Aplicación**: tool MCP `apply_theme` (escribe `PageLayout.theme`,
  `null` lo borra; `content:read` + `content:write` + auditoría, membership
  accionable) y `list_themes` (catálogo con `source: builtin|installed` y
  vars ya resueltas). Ejemplo real: `jerry-bantz` con `2pac-dark`.
- **`2pac-dark`** (builtin de ejemplo): paleta oficial oscura desplazada a
  tinta profunda (`#14100C`) con **naranja como acento** y lima como acent-2.
  Todos sus pares de texto pasan AA por matemática WCAG en
  `tests/unit/theme-pack.test.ts` — no es una paleta improvisada.
- **`portaless-nocturno` (default del ecosistema)**: la paleta oscura del
  ecosistema Portaless — tinta muy profunda (`#0E0B08`) con el **lima oficial**
  como acento y el naranja como acent-2. Es el look que un visitante ve en las
  superficies del ecosistema: el **home** (lo declara en su `PageLayout`), el
  **blog** (índice y cada post) y **Explore** (los dos lo aplican con
  `src/lib/ecosystem-theme.ts`, porque no son `PageLayout`). **Es un default de
  diseño, no un color fijo: el admin puede cambiarlo por página** con
  `apply_theme` (o el editor), como cualquier theme pack. Los efectos
  ambientales (fondo con degradado, capa de puntos, titular en degradado, hover)
  viven en `global.css` bajo `[data-theme-pack="portaless-nocturno"]` — CSS-only,
  sin `!important`, respetando `prefers-reduced-motion`. Las **plantillas demo**
  (`/paginas/*`) no lo heredan: conservan su propio look para mostrar la
  variedad de temas.

## 6. Accesibilidad

- **AA por matemática y por navegador**: todo par de texto nuevo se calcula
  (fórmula WCAG en los tests) **y** se verifica en un browser real
  (specs Playwright + muestreo de elementos cuando el cambio es grande).
- El botón sólido usa texto tinta `#261C15` sobre `var(--accent)` → 5,0:1 en
  lima y 5,0:1 en naranja (`2pac-dark`), cumple AA incluso en negrita normal.
- **Límite honesto conocido**: los bordes `--panel-border` (1,28:1) y
  `--portaless-border` (1,41:1) están por debajo del 3:1 no-texto; los inputs
  se distinguen por relleno + label. Subirlo exige tocar la paleta oficial
  bloqueada, queda registrado en el CHANGELOG.
- Iconos: SVG inline Lucide con `stroke="currentColor"` (`icons.ts`), nunca
  emoji como interfaz.

## 7. Dónde vive cada cosa

| Qué | Archivo |
|---|---|
| Tokens y mapeo a CSS | `packages/dashboard/src/skin-engine/tokens.ts` |
| Skin del sitio (store/resolución/emisor) | `packages/dashboard/src/skin-engine/` |
| Paleta por defecto de la hoja pública | `src/styles/global.css` |
| Fuente de verdad de vocabulario/lang | `src/lib/site-lang.ts` |
| Chrome público | `src/components/{Header,Footer}.astro`, `src/pages/explore.astro` |
| Contrato de temas por página | `packages/atomic-elements/src/themes/theme-pack.ts` |
| Store de temas instalados | `packages/atomic-elements/src/persistence/theme-pack-store*.ts` |
| Emisores (build / runtime) | `src/layouts/BaseLayout.astro`, `functions/paginas/[slug].js` |
| Tools MCP | `packages/mcp-server/src/tools/{list-themes,apply-theme}.ts` |

## 8. Tests que fijan esta guía

- `tests/unit/theme-pack.test.ts` — paridad allowlist/máscara, validación,
  resolución, contraste AA del ejemplo.
- `tests/unit/theme-pack-store.test.ts` — tres backends, filas corruptas, factory.
- `tests/unit/mcp-apply-theme.test.ts` — tools, permisos, auditoría, membership.
- `tests/unit/site-page-theme.test.ts` — paridad de emisión entre los dos
  caminos de render (incluida la prohibición de la regla de hoja).
- `tests/unit/paginas-runtime-route.test.ts` — el HTML real del runtime.
- `tests/browser/page-theme.spec.ts` — tokens calculados en navegador con SO
  oscuro emulado.
- `tests/unit/site-lang-vocab.test.ts`, `site-ecosystem-footer.test.ts`,
  `profile-header-share.test.ts` — el chrome de la sección 4.

## 9. Límites honestos

- El **marketplace** de temas (subida de zip, consentimiento estilo Permissions
  Center) vive fuera de este repo (AppPlace/AppLibre); aquí está el contrato,
  el store y las tools, no la instalación pública.
- El **build estático solo resuelve builtins** (no lee `theme_packs`: no hay
  base de datos en el build). Un tema instalado aplica en runtime y vía MCP.
- `SITE_LANG` es constante, no negociación de idioma por visitante (no hay i18n).
- La guía documenta el sistema actual: cambios de paleta/tipografía deben
  actualizarse aquí **en el mismo PR**.
