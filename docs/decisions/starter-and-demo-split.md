# PR-B1 — Separar starter canónico y marketing/demo

Estado: **propuesta de diseño, sin implementación**. Base inspeccionada: `2eb7acb`
(#114 fusionado). Autorización escrita: PR-B1 solamente. PR-B2, PR-C y PR-D–G
no se inician con este documento. Decisiones aplicables: [D1–D11](owner-decisions-2026-10-31.md).
LTP = Local Trust Protocol; LTP Stack = APW + LTP + SVRI + HSVR.
G4/G5 siguen PENDING_AUTHORIZATION; `packages/ltp-engine` permanece inactivo.

## 1. Hechos y clasificación

Clases: **A** starter canónico; **B** marketing/demo; **C** sistema/motor;
**D** contenido personal que debe exportarse y sustituirse en el árbol actual.
Una misma fuente puede contener motor C y copy B/D. Clasificar no autoriza borrarla.

### 1.1 Contenido que entrega el clon

Inventario obtenido con Glob sobre `src/content/**/*`; las referencias `:1`
identifican archivos completos, no verifican que sus afirmaciones sean ciertas.

| Ruta actual | Clase | Destino propuesto / tratamiento |
|---|---|---|
| `src/content/home.json:1` | B | Home de marketing EN → demo; nueva home mínima A |
| `src/content/home.es.json:1` | B | Proyección ES → demo exclusivamente |
| `src/content/posts/bienvenida.md:1-21` | B | Conservar en demo; crear post A en inglés, sin reutilizar su copy español |
| `src/content/pages/ejemplo-atomic-elements.json:1` | B | Catálogo de elementos demo |
| `src/content/pages/ejemplo-atomic-elements.en.json:1` | B | Traducción del catálogo demo; mantener relación con su primaria |
| `src/content/pages/jerry-bantz.json:1` | D → B ficticio | Exportar original al repo del dueño; sustituir por creador ficticio, sin canales reales |
| `src/content/pages/musica-merch.json:1` | B + D | Mantener músico/merch; sustituir canales personales y medios |
| `src/content/pages/link-in-bio.json:1` | B + D | Mantener caso de uso; sustituir canales reales |
| `src/content/pages/club-evento.json:1` | B | Mantener evento/club ficticio; revisar ubicación y todas las imágenes |
| `src/content/pages/boutique.json:1` | B | Mantener boutique ficticia; sustituir retrato/formulario externo |
| `src/content/pages/portafolio.json:1` | B | Mantener portafolio ficticio |
| `src/content/pages/lanzamiento.json:1` | B | Mantener lanzamiento ficticio; revisar vídeo |
| `src/content/pages/servicios.json:1` | B | Mantener servicios ficticios |

Los ocho casos D8 siguen visibles en demo, con etiqueta **“Demo content, fictional”**:
creador/influencer, músico y merch, evento/club, boutique, portafolio, lanzamiento,
servicios y link-in-bio. No se publican con el perfil starter.

### 1.2 Rutas públicas, motores y sistema

| Rutas de fuente actuales | Clase | Starter / demo |
|---|---|---|
| `src/pages/index.astro:1`, `src/pages/es/index.astro:1`; `src/components/HomePage.astro:1` | C + B | Motor común; seleccionar home A o B; no emitir `/es/` en starter |
| `src/pages/beta.astro:1`, `src/pages/es/beta.astro:1`; `src/components/BetaPage.astro:1` | B | Solo demo |
| `src/pages/docs/index.astro:1`, `src/pages/docs/[...slug].astro:1`, `src/pages/docs/[...slug].md.ts:1` | B + C | Código conservado; no emitir documentación de Portaless en starter |
| `src/pages/projections.astro:1`, `src/pages/es/projections.astro:1`; `src/components/ProjectionsPage.astro:1` | B | Solo demo; su referencia al post español también cambia por perfil |
| `src/pages/shop/index.astro:1`, `src/pages/shop/[handle].astro:1`, `src/pages/es/shop/index.astro:1`; `src/components/StoreIndexPage.astro:1` | C + B | Sin tienda emitida en starter inicial; módulo se conserva; demo conserva vista actual con datos ficticios |
| `src/pages/explore.astro:1`, `src/pages/es/explore.astro:1`; `src/components/ExplorePage.astro:22-115` | C + B | Explore EN mínimo en starter; copy/categorías/docs/ES de demo solo en demo |
| `src/pages/pages/[slug].astro:1`, `src/pages/[locale]/pages/[slug].astro:1`; `src/components/ContentPage.astro:1` | C | Resolver solo contenido activo; preservar URLs canónicas |
| `src/pages/paginas/[slug].astro:1`, `src/pages/[locale]/paginas/[slug].astro:1` | C | Redirecciones solo para contenido activo; no emitir slugs demo en starter |
| `src/pages/blog/index.astro:1`, `src/pages/blog/[...slug].astro:1`, `src/pages/blog/[...slug].md.ts:1` | C | Blog y Markdown con posts del perfil activo |
| `src/pages/rss.xml.ts:1`, `src/pages/llms.txt.ts:1`, `src/pages/sitemap.xml.ts:1`, `src/pages/robots.txt.ts:1` | C | Generar desde el mismo catálogo activo; nada de demo en starter |
| `src/pages/setup.astro:1`, `src/pages/api/analytics.ts:1` | C | Conservar; no rediseñar seguridad/telemetría por el perfil |
| `src/pages/trust/index.astro:1`, `src/pages/trust/veracier/index.astro:1`, `src/pages/trust/explicacion-svri.astro:1` | C + copy B | Conservar fuentes; revisar copy específico de producto; no cambiar API ni bytes firmados |
| `functions/**`, especialmente `functions/.well-known/*.js` y `functions/admin/**` | C | No mover ni conectar motores nuevos; mantener rutas y controles |

Inventario de páginas admin (todas C, conservar rutas y autenticación):
`src/pages/admin/{index,login,login-mfa,password-reset,pages,editor,publish,backup,permissions,appearance,analytics,agents,settlement,recents,authorized-agents,authorized-escrow-providers,witness-index,trust-svri}.astro`;
`src/pages/admin/security/index.astro`, `src/pages/admin/settings/email.astro`,
`src/pages/admin/site-trust/[siteId]/self.astro`, `src/pages/admin/trust/hsvr.astro`;
`src/pages/admin/wizard/{index,step-1-intent,step-2-infrastructure,step-4-backup-key,step-5-admin-credentials,rotate-identity}.astro`.
No se renombra ninguno; el panel español actual no se traduce incidentalmente.

### 1.3 Assets, capturas y entradas de build

- `public/favicon.svg`, `public/fonts/{IBMPlexMono-Regular,Inter-Variable,Fraunces-Variable}.woff2`:
  C, activos compartidos; revisar branding del starter sin quitar licencias.
- `public/avatars/jerry-bantz.svg`: D, exportar/sustituir por SVG geométrico ficticio.
- `public/editor/index.html`, `public/permissions/index.html`: C/demo auxiliar;
  conservar fuentes pero revisar emisión para evitar demos standalone en starter.
- `public/_headers`: C; conservar política de seguridad.
- `public/{tienda,proyecciones}/index.html`,
  `public/en/{tienda,proyecciones,beta}/index.html`: redirecciones B/C;
  no copiarlas a starter hacia destinos que no se emiten.
- `scripts/capture-screenshots.mjs:24,61,73-84`: B/C; salida en `docs/screenshots/`,
  lectura directa de JSON y URLs demo. Debe exigir perfil demo, usar fixtures ficticios
  y capturar de nuevo; no presentar las capturas antiguas como evidencia del nuevo demo.
- `.github/workflows/deploy-pages.yml:20-27,50-57`: B/C; añadir explícitamente perfil
  demo en PR-B2 y paths del nuevo contenido para que un cambio de demo dispare build.
  No tocar ajustes de Pages ni permisos/protecciones.
- `scripts/browser-test-server.mjs`, `scripts/staging/disposable-staging.mjs`: C;
  fixtures de pruebas deben seleccionar perfil, nunca copiar datos del dueño.
- `scripts/{publish-site,public-build-stage,public-revision-export,prune-build-inputs}.mjs`:
  C; publicación y limpieza deben entender el perfil sin ampliar la allowlist privada.
  `scripts/public-build-stage.mjs:8,51-53,145,196` prueba que los paths actuales
  están codificados; mover archivos sin ajustar estas entradas rompería publicación.

Capturas presentes (B; reauditar texto/personas/metadatos, no asumir inocuas):
`docs/screenshots/admin-dashboard.png`, `admin-permissions.png`,
`editor-atomic-elements.png`, `editor-publish.gif`, `trust-score.png`,
`public-home.png`, `public-home-es.png`, `public-home-mobile.png`,
`public-blog.png`, `public-docs.png`, `public-docs-detail.png`,
`public-explore.png`, `public-explore-es.png`, `public-projections.png`,
`public-page-translated.png`, `public-link-in-bio.png`, `jerry-bantz-linktree.png`,
`header-share-button.png`, `header-actions-video.png`, `header-actions-shop.png`,
`header-actions-map.png`, `atomic-map-element.png`, `portaless-footer.png`.
Los nombres tras el primero son relativos a `docs/screenshots/`.

## 2. Diseño recomendado (no implementado)

| Opción | Ventajas | Coste/esfuerzo y riesgos | Recomendación |
|---|---|---|---|
| A. Flag y filtros sobre archivos mezclados | Movimiento inicial pequeño | Cada glob/copia debe filtrar; riesgo de incluir demo por error | No |
| B. Perfiles físicos + catálogo único de build | Ausencia comprobable de demo en starter; comparte motor | Ajustar loaders, rutas, publicación y tests | **Sí** |
| C. Marketing en repo independiente ahora | Separación física | Duplicación y migración del workflow; contradice D11 | No ahora |

Propuesta B: `PORTALESS_SITE_PROFILE=starter|demo`, ausencia = `starter`.
Valor desconocido aborta build; nunca cae silenciosamente a demo. El perfil elige
un catálogo de contenido/rutas/activos públicos; no permisos ni políticas Trust Layer.
Estructura propuesta para PR-B2 (nuevos paths, todavía inexistentes):

```text
site-profiles/starter/home.json
site-profiles/starter/posts/welcome.md
site-profiles/starter/pages/                 # vacío inicialmente
site-profiles/demo/home.json
site-profiles/demo/home.es.json
site-profiles/demo/pages/*.json             # MOVE de los ejemplos; ficticios
site-profiles/demo/posts/bienvenida.md
site-profiles/demo/public/                  # assets exclusivamente demo
```

Mantenerlos fuera de `public/` evita copia automática de ambos perfiles.
Un módulo común, p. ej. `src/lib/site-profile.ts` (propuesto), resuelve catálogo,
locales, rutas y configuración. No basta con esconder enlaces: las páginas B
deben quedar **ausentes de dist/** en starter. Diseñar en PR-B2 exclusión de rutas
Astro antes de generación (incluidas las rutas index fijas), no borrar HTML después
del build dejando sitemap/JS con referencias. Los motores C y los endpoints
autenticados permanecen; no convertir un perfil en bypass de autorización.

### 2.1 Lectores que deben compartir el catálogo

- Home importa JSON directamente: `src/pages/index.astro:1-9` y `src/pages/es/index.astro:1-7`.
- `src/lib/content-pages.ts:104-108` usa un glob fijo; Explore tiene otro independiente
  en `src/components/ExplorePage.astro:109-115`. Ambos deben converger al catálogo.
- `src/content.config.ts:5-6` fija posts; `:16-24` carga docs del nav.
  No cargar docs de Portaless en starter, aunque continúen disponibles en el repo.
- `src/pages/sitemap.xml.ts:53-69` enumera hoy ES/beta/shop/projections/docs incluso
  sin comercio: `ENABLE_COMMERCE=false` por sí solo no elimina rutas.
- `src/lib/llms-txt.ts`, `src/lib/sitemap.ts`, `src/pages/rss.xml.ts`,
  `src/components/{Header,Footer}.astro`, `src/lib/docs-nav.mjs`,
  `src/lib/projections.ts`: alimentar solo rutas y contenido activo.
- `createPublicBuildEnv()` y el staging público deben propagar el perfil permitido;
  la publicación integrada debe conservar la selección del operador. Prueba requerida:
  publicar starter no reintroduce demo desde archivos del repo.
- Un cambio de perfil no migra ni elimina automáticamente contenido del PageStore.
  Bases existentes conservan páginas/identidad/políticas; el alcance inicial es el
  clon limpio y la proyección de build, no una migración destructiva de instalaciones.

### 2.2 Contrato starter

- Home EN con el motor Atomic Elements: título editable, párrafo breve, enlace al blog
  y últimos posts del catálogo activo. Un solo canon de home en `/`; no duplicarlo
  como otra página de ejemplo bajo `/pages/`.
- Post `Welcome to your Portaless site` en inglés: editar Markdown o editor/MCP cuando
  exista nodo, revisar/aprobar y publicar según perfil. No prometer panel en GitHub Pages.
- Comercio desactivado; sin páginas de ejemplo, tienda, `/beta`, docs de Portaless,
  `/projections`, `/es/` ni sus redirecciones vacías. Mecanismo i18n intacto (D10).
- `/explore/` muestra una home y un post, sin duplicar home como página ni mostrar
  fichas de demo/docs, tiendas o ranking inventado. Reutilizar clasificación local;
  copy EN neutral. Sitemap/llms/RSS describen solo estas publicaciones y hubs reales.
- Rutas de sistema (setup/admin/trust/API) siguen separadas del contenido inicial;
  su existencia no autoriza publicación de datos de estado interno.

### 2.3 Demo, wizard y pruebas de enlaces

Demo conserva marketing EN/ES, catálogo de elementos y los ocho casos D8 con
nombres inventados, sin cuentas personales ni etiquetas afiliadas. Visible
“Demo content, fictional” en todas las páginas/casos, no solamente en el footer.
Mover fuentes, no descartar la demostración; anonimizar contenido personal al mover.
Mantener identificadores de elementos y rutas de sistema; cualquier slug personal
a neutral se documenta como cambio aprobado de contenido, no como renombrado de DID.
No alterar vectores, firmas ni fixtures criptográficos.

Plantillas `packages/onboarding/src/intent-to-layout.ts:76-129`: conservar como
opciones (D9), interfaz de locale explícita con default `en`. Copy inglés por defecto;
español solo al solicitar `es`, no por inferencia del texto libre. Los valores
del usuario no se traducen/inventan. No emitir enlaces `https://`, raíces sociales
ni formularios de un tercero como si estuvieran configurados.

Requisito de test propuesto `tests/unit/onboarding-locale-links.test.ts`:
ejecutar `TemplateIntentToLayout.generate()` en portfolio/store/link-in-bio/landing
con locale omitido/en/es; comprobar copy, destinos, no raíces de plataformas,
draft por defecto y ninguna llamada de red. Defaults deben ser enlaces internos
reales/anclas existentes o campos opcionales sin enlace; URLs del usuario se validan.
`tests/unit/demo-pages-links.test.ts:9-10,28-63` solo inspecciona JSON de páginas,
no salida del wizard. Mantenerlo y sumar cobertura, nunca relajar sus prohibiciones.

Usar el [patrón E2](../testing/demo-fictional-links-pattern.md) como punto de partida:
CTAs internas y ausencia de cuentas sociales reales. **Corrección al análisis previo:**
`demo-pages-links` no consulta DNS; que acepte una URL no demuestra que resuelva.
`example.org/portaless-demo/...` pasa la validación sintáctica, pero sus paths no se
comprobaron y no se presentarán como destinos funcionales. Recomendación: landing
interna de enlaces ficticios con anclas reales; no sustituir cuentas del dueño por
cuentas de otra persona. Guardar prueba del destino y resolución cuando se elija
un externo. Esta elección requiere confirmación en la revisión B1.

## 3. Auditoría de imágenes y medios

Se inventarían referencias, **no se certifican licencias por el hostname**.
Revisión de `https://unsplash.com/license`: herramienta devolvió HTTP 401;
autor/ficha original/licencia por fotografía **NO VERIFICABLE**. `https://placehold.co/`
devuelve documentación de tamaños/colores/formatos, sin concesión de licencia por
activo en el texto obtenido. Sus variantes tampoco quedan aprobadas por defecto.

Cada fila es un activo o variante encontrado; no se reproducen fotos en este PR.

| Fuente exacta y ubicación | Origen identificado | Licencia / personas / acción B2 |
|---|---|---|
| `photo-1590602847861-f357a9332bbc`, `src/content/pages/jerry-bantz.json:72` | `images.unsplash.com` | NO VERIFICABLE; sustituir tarjeta comercial por producto ficticio interno |
| `photo-1539185441755-769473a23570`, `musica-merch.json:74` | `images.unsplash.com` | NO VERIFICABLE; ficha/autor/licencia pendientes |
| `photo-1521572267360-ee0c2909d518`, `musica-merch.json:87` | `images.unsplash.com` | NO VERIFICABLE; ficha/autor/licencia pendientes |
| `photo-1514525253161-7a46d19cd819`, `club-evento.json:59` | `images.unsplash.com` | NO VERIFICABLE; inspección visual de personas pendiente |
| `photo-1492684223066-81342ee5ff30`, `club-evento.json:72` | `images.unsplash.com` | NO VERIFICABLE; inspección visual de personas pendiente |
| `photo-1470225620780-dba8ba36b745`, `club-evento.json:85` | `images.unsplash.com` | NO VERIFICABLE; inspección visual de personas pendiente |
| `photo-1544441893-675973e31985`, `boutique.json:38` | `images.unsplash.com` | NO VERIFICABLE; ficha/autor/licencia pendientes |
| `photo-1544816155-12df9643f363`, `boutique.json:51` | `images.unsplash.com` | NO VERIFICABLE; ficha/autor/licencia pendientes |
| `photo-1507473885765-e6ed057f782c`, `boutique.json:64` | `images.unsplash.com` | NO VERIFICABLE; ficha/autor/licencia pendientes |
| `photo-1534528741775-53994a69daeb`, `boutique.json:84` | `images.unsplash.com` | Avatar: retirar/sustituir por arte geométrico, sin foto de persona real |
| `https://placehold.co/160x160`, `portafolio.json:11` y wizard `:85,105` | Placeholder remoto | Licencia NO VERIFICABLE; proponer SVG local original |
| `https://placehold.co/96x96`, `portafolio.json:36`, `servicios.json:39`, `lanzamiento.json:40` | Placeholder remoto | Licencia NO VERIFICABLE; proponer SVG local original |
| `https://placehold.co/600x600`, `portafolio.json:23` | Placeholder remoto | Licencia NO VERIFICABLE |
| `https://placehold.co/600x600/C5D86D`, mismo `:23` | Variante de color | Licencia NO VERIFICABLE |
| `https://placehold.co/600x600/261C15`, mismo `:23` | Variante de color | Licencia NO VERIFICABLE |
| `https://placehold.co/160x160/261C15/C5D86D?text=AR&font=source-sans-pro`, `link-in-bio.json:11` | Placeholder remoto con tipografía | Licencia de salida/fuente NO VERIFICABLE |
| `public/avatars/jerry-bantz.svg:1` | Asset local del perfil personal | No aprobación para conservar datos personales; sustituir y exportar original |
| Capturas listadas en §1.3 | Generadas por navegador; pueden incorporar imágenes/textos de terceros | Revisión visual/licencias no ejecutada; regenerar tras anonimizar |

En la tabla, nombres de JSON sin prefijo son relativos a `src/content/pages/`.
El inventario cubre las URLs de imagen de los JSON y el wizard encontrados, incluidas
variantes de Gallery. Auditar además los medios remotos que pueda devolver Medusa
al ejecutar demo: no hay corpus remoto ni credenciales medido aquí.

Vídeo compartido en `musica-merch.json:22` y `lanzamiento.json:21`: origen YouTube,
licencia de vídeo/thumbnail no comprobada; no asumir que un embed permite reutilizar
todo su material. Preferir placeholder local original antes de publicar demo.
`boutique.json:105` contiene endpoint de formulario externo: reemplazar por
demostración no operativa claramente indicada, sin enviar datos a terceros.

**Gate de activos para B2:** por imagen conservar URL/ficha original, autor,
licencia/version y enlace, fecha/método de comprobación, atribución y autorización
de distribución cuando aplique. Sin esa evidencia, reemplazar por SVG/arte original
sin personas reales y registrar autoría/licencia. No declarar ninguna imagen
aprobada en este PR. No es asesoría legal.

Tarjeta actual `src/content/pages/jerry-bantz.json:65-77`: retirar enlace de compra
externo y semántica afiliada; sustituir en demo por producto ficticio con CTA interna
existente. No se ha identificado una etiqueta afiliada de consulta en ese URL:
no inventar que existe; la semántica y los datos personales bastan para sustituirla.

## 4. Datos personales ya fusionados: editar el árbol, no la historia

No copiar canales, nombres reales, ubicaciones ni claves a este documento. Referencias
de ruta identifican los activos a revisar, no son autorización para conservar su copy.

| Fuente existente | Redacción neutra propuesta (edición futura) |
|---|---|
| `CHANGELOG.md:208` | “Canonical creator, music/merch, event and boutique examples; demo data is fictional.” Quitar referencia a slug personal, conservar el hecho histórico de la función |
| `CHANGELOG.md:210` | “Map and ProductCard examples, plus a fictional creator profile.” Retirar nombre, país, canales, métricas de audiencia y recomendación comercial del dueño; no sustituirlos por números inventados |
| `CHANGELOG.md:212` | “Per-page theme demonstrated on a fictional demo profile.” Conservar explicación técnica; quitar identificación del dueño |
| `docs/architecture/content-architecture-and-use-cases.md:13` | “Creator/influencer example (`/pages/creator-demo/`)” solo cuando el destino exista; describir capacidades sin afirmar audiencia/costo medido |
| `docs/design/design-guide.md:92,96,167` | “Fictional creator profile with synthetic identity fields and demo links.” Quitar país/cuentas/visitas reales; remitir al caso ficticio y su inventario |

Método: antes de B2, dueño exporta contenido público original (JSON/posts/assets)
a su repo independiente y comprueba allí sus páginas. Backups de DB, `.env`, claves,
credenciales y datos privados se guardan fuera de ambos repos públicos. Después,
editar/mover el árbol actual por PR normal y conservar casos ficticios; no hacer
force-push de `main` ni reescritura masiva. El historial y SHAs antiguos siguen
conteniendo material previo; este método no promete borrarlo. No renombrar DID
`did:apw:<tu-dominio>` ni artefactos firmados para hacerlos coincidir con slugs demo.

## 5. Tests afectados y separación propuesta

Inventario verificable de dependencias (fuentes y nombres exactos):

| Test/script | Dependencia actual / tratamiento propuesto |
|---|---|
| `tests/unit/static-sweep.test.ts` | Build y enlaces públicos completos; correr demo, sumar barrido starter |
| `tests/unit/demo-pages-links.test.ts:9-10,28-63` | JSON demo y prohibiciones; conservar, apuntar perfil demo sin pasar por vacío |
| `tests/unit/home-honesty.test.ts:12-27` | Home marketing fijo; demo |
| `tests/unit/content-subpath-urls.test.ts:17,47` | Todas las páginas y assets bajo `/portaless/`; ambos perfiles |
| `tests/unit/sitemap.test.ts` | Entradas conocidas; ambos catálogos con expectativas diferentes |
| `tests/unit/explore-ranking-source.test.ts` | Copy fuente local y filtros; conservar garantías, separar copy demo |
| `tests/unit/projections-demo.test.ts:36` | Post español fijo; demo |
| `tests/unit/i18n.test.ts`, `tests/unit/content-pages.test.ts:38-58` | Motor/locales; conservar como tests unitarios de C, sin requerir publicar ES en starter |
| `tests/unit/{live-status-claims,capability-claims,policy-claims}.test.ts` | Home EN/ES y copy comercial; demo, sin reducir exigencias de honestidad |
| `tests/unit/{shop-product-fallback,site-page-theme,trust-page-honesty}.test.ts` | Contenido demo/personal concreto; sustituir fixtures por ficticios sin perder aserciones |
| `tests/unit/{header-share,atomic-responsive-icons,routes}.test.ts` | Paths/avatar personales como fixtures; neutralizarlos manteniendo contrato de rutas/render |
| `tests/unit/redirects-map.test.ts:68,128-131` | Slugs históricos y build; mapas del perfil activo, sin eliminar pruebas de redirect; PR-G separado |
| `tests/unit/wizard-intent.test.ts` | Generación determinista; conservar y ampliar con `onboarding-locale-links.test.ts` propuesto |
| `tests/unit/{public-build-stage,publish-draft-filter,private-artifact-boundary}.test.ts` | Frontera de publicación; ambos perfiles, sin ampliar secretos exportables |
| `tests/browser/{mobile,header-mobile,page-theme,public-ecosystem-footer}.spec.ts` | Slugs demo/personales fijos; demo ficticio; starter con smoke propio |
| `tests/browser/{projections-demo,page-publish-cycle,llms-txt-db}.spec.ts` | Post/demo/static fixture; demo para casos existentes, mantener aislamiento DB |
| `scripts/capture-screenshots.mjs:61-84` | Perfil demo explícito y assets ficticios; no ejecutado en B1 |

El listado no presupone que el nombre de un test sea garantía de cobertura.
En B2 volver a buscar cada path/slugs/import glob tras los movimientos, incluidos
tests de footer/nav y scripts de publicación; cualquier referencia no listada es
seguimiento, no motivo para quitar un test. Suite completa debe seguir ejecutando
pruebas demo y starter: ningún perfil puede reducir el corpus por omisión.

## 6. Cloudflare Pages y monitoreo (propuesta separada)

Hecho: `server/node-runtime.mjs:206` responde `/healthz` antes del middleware, solo
en Node. No existe Function `/healthz` en `functions/`; tampoco hay asset en
`public/` ni ruta en `src/pages/`. `public-bot-routes.ts:12-18` no lo exime.
En Pages/Functions el monitoreo con Trust Layer activo **no está cubierto** por
una ruta dedicada equivalente. No describir `/healthz` Node como garantía edge.
Tampoco el perfil `demo` ni `starter` decide exenciones de Trust Layer.

Proponer PR pequeño, separado de B2 y sujeto a autorización: ruta de liveness
con cuerpo constante (p. ej. `ok`), status 200, GET/HEAD, sin DB, identidad,
conteos, versión, env ni detalles de servicios. Exención exacta de pathname
(no prefijo) antes del rechazo de UA; pruebas sin red para UptimeRobot y UA con
`bot`, `/healthz-extra` no exento, métodos no permitidos, Trust Layer on/off y
ausencia de estado interno. La ruta comprueba que responde el servicio, no
readiness de DB ni disponibilidad global. Nombre/ubicación final requieren dueño.
No implementar ni ampliar exenciones en PR-B1. No confundir esta propuesta con
PR-G (`redirects-map`), cuya autorización es independiente.

## 7. Plan de pruebas de PR-B2 con clon limpio (no ejecutado aquí)

1. Clon nuevo del SHA B2 en directorio desechable, sin `.env`, DB, caché de Astro,
   `dist/` ni fixtures del mantenedor. Registrar Node/npm/SO/SHA. `npm ci`.
2. Sin `PORTALESS_SITE_PROFILE`: `npm run build`. Inventariar `dist/` y comparar
   catálogo permitido: home, welcome, hubs reales y rutas C previstas; ausencia
   física de demo/ES/beta/docs/shop/projections y de redirecciones a esos destinos.
3. Inspeccionar HTML/JS/JSON, sitemap, llms, RSS y Explore: ningún slug/canal/imagen
   demo; un canon de home y un post, sin duplicados. Validar enlaces de subpath y `/`.
4. Configurar env efímero fuera del repo (`PORTALESS_SQLITE_PATH`,
   `PORTALESS_PUBLIC_URL=http://127.0.0.1:3000`, `HOST=127.0.0.1`); `npm start`.
   Verificar setup pendiente sin usar credenciales reales. Ejecutar `npm run setup`
   con base efímera, reiniciar y comprobar login/editor/backup/publicación simulada.
   Cubrir además `/setup` en otra base vacía; no afirmar que la prueba CLI cubre UI.
5. `PORTALESS_SITE_PROFILE=demo npm run build` en salida separada: conserva rutas
   públicas funcionales, marketing EN/ES y ocho casos ficticios, licencia por activo,
   sin personas/cuentas del dueño ni afiliados; etiqueta visible. Snapshot visual
   solo de cambios aprobados por D8, no promesa de bytes idénticos al demo personal.
6. Demo explícito para tests/capturas y workflow Pages. Ejecutar los cuatro checks
   del repo y nuevas pruebas starter/wizard; cero `skip` añadidos para esconder fallos.
7. Build demo → starter en la misma salida y orden inverso: no quedan artefactos
   residuales. Perfil desconocido falla; despliegue/publicación no eligen demo solos.
8. Fronteras privadas y estado existente: publicación simulada de snapshot aprobado,
   drafts/privados ausentes, DB existente intacta, identidad y firmas byte-for-byte
   inalteradas. No ejecutar publicación real ni activar G4/G5.

Costos de B no medidos: esfuerzo de loaders/rutas/tests y tamaño del repo por
conservar demo. No hay cifra monetaria o de rendimiento nueva en esta propuesta.

## 8. Decisiones de revisión pendientes y entrega

D8–D11 ya están decididas; no volver a tratarlas como preguntas. Requieren revisión:

| Tema | Opciones | Recomendación / condición |
|---|---|---|
| Directorios y selección | A/B/C de §2 | B, `starter|demo`, validar con dueño antes de B2 |
| Enlaces ficticios | Landing interna / externos reservados | Landing interna; ningún path externo supuesto funcional |
| Imágenes sin licencia individual | Recuperar evidencia / arte original | No publicar las no verificadas; arte original sin personas |
| Panel español | Traducir en B2 / PR i18n aparte | PR aparte; wizard EN por defecto sí forma parte del diseño B2 |
| Liveness Pages | Ruta exacta constante / seguir monitorizando sitemap | Ruta separada con autorización, sin revelar estado |

PR-B2 solo tras aprobación de este diseño y autorización escrita. Dueño: exportar
sitio real, responder A2, aprobar redacciones A8, autorizar PRs, contraste de bloqueo
IA y observación del túnel, C1, artículo del blog, medir instalación con otra persona,
endurecer nodo y recurrir a asesoría legal si procede. No se ejecutan aquí.

**NO VERIFICABLE en B1:** licencias individuales/autoría de imágenes remotas,
destinos ficticios externos, despliegue Pages real y monitoreo edge, exportación
del sitio del dueño, clon limpio del diseño aún inexistente, funcionamiento de
los perfiles propuestos. Verificación actual del repo se reporta en el PR;
no equivale a aceptación del futuro starter.
