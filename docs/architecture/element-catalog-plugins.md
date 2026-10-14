# Catálogo extensible de elementos vía Plugins — Diseño

## Estado real

**IMPLEMENTADO (v0.0.9.11).** Este documento define la arquitectura que permite que un plugin (ej. `portaless-plugin-paywall`) contribuya sus **propios elementos** al catálogo de Atomic Elements — para que el editor visual y un agente MCP los vean y los usen — **sin que el núcleo cambie y sin romper el AST determinista.** El *slice delgado* de esta arquitectura ya está en el repo (ver "Slice delgado" más abajo); lo que queda explícitamente pendiente es la *segunda pasada* (edge-eval end-to-end con sandbox, `secretProps` con guard de build, y UI de instalación de packs).

Hoy el catálogo está **cerrado** por tres anclas simultáneas, no por una sola:

- `elementRegistry` (`packages/atomic-elements/src/elements/registry.ts:364`) es un objeto literal plano y **no congelado** — técnicamente `elementRegistry["Foo"] = def` funcionaría en JS — pero…
- `ElementType` (`packages/atomic-elements/src/types.ts:1-4`) es una **unión cerrada** de string literals; TypeScript rechaza una clave nueva.
- `validateNode` (`packages/atomic-elements/src/persistence/page-schema.ts:14-16`) rechaza cualquier `node.type` que no esté en el registro, tanto al guardar como al renderizar.
- Y el test `tests/unit/mcp-element-schema-parity.test.ts` exige `registry == palette == schema enum`.

Es decir: el objeto es mutable, pero **el sistema está cerrado a su alrededor**. Abrir el catálogo no es hacer `Object.freeze` al revés; es añadir una capa que conviva con el core cerrado.

Además **no existe ningún hook de render**: `renderNode` (`render.ts:5`) es un lookup directo `elementRegistry[node.type]`. No hay middleware, ni punto de extensión. Y **ningún plugin inyecta elementos hoy** — `commerce-plugin` devuelve JSON de productos, pero `ProductGrid`/`StoreBlock` son elementos *core* en `registry.ts` que *consumen* al plugin, no al revés.

## Qué es y qué no es

**Es**: un mecanismo para que un plugin declare elementos como **datos** (schema + template), que el host valida, persiste en una store en DB, y fusiona con el catálogo core en un **catálogo resuelto** que consumen el render, la validación, el MCP y el editor.

**No es**: un sandbox de código de render. El plugin **no** entrega una función `renderHTML`. Entrega un template que **el host** interpola y escapa. La frontera es deliberada y viene del precedente que el repo ya probó:

> **Precedente `ProductGrid`**: el *host* guarda la función de render (`registry.ts:125` → `src/commerce/medusa-client.ts` → `host-bridge.ts`), y el *plugin* provee **datos** (`fetchProducts` retorna JSON). Una función no cruza un `isolated-vm`, y el AST debe seguir siendo JSON serializable y determinista. Esa misma frontera se aplica aquí.

**Tampoco es** un segundo sistema de billing ni un paywall en el núcleo. El núcleo de Portaless no lleva gating de pago; su economía ya es pay-per-crawl. Este diseño solo abre la puerta por la que un *plugin* de paywall puede existir fuera del core.

## Por qué este diseño y no ensanchar `ElementType`

Ensanchar `ElementType` a `string` (o a una unión con los tipos de plugin) destruiría lo que acabamos de trabar: el type-safety del AST, la validación de `validatePageLayout`, y la paridad MCP-core que fija el test. Un tipo de plugin además no puede estar en la unión de compile-time porque **no existe hasta que el operador instala el pack en una DB específica** — es dato de runtime, no de build.

La separación core ∪ packs es también la que el repo ya usa en otros dos sitios: `capabilityRegistry` (catálogo estático) convive con `PluginRegistryStore` (store en DB mutable), y `elementRegistry` (estático) convive con `ElementPackStore` (store en DB mutable). Es el mismo patrón, aplicado al catálogo de elementos.

## Los tres problemas, resueltos

### 1. Inyección en el registro — *element packs*, datos no funciones

Un `ElementPack` es una contribución **declarativa y DATA-ONLY**:

```ts
interface ContributedElement {
  type: string;                    // namespaced: "paywall.Boundary", "demo.Badge"
  displayName: string;
  icon: string;                    // nombre de icono o SVG inline
  defaultProps: Record<string, unknown>;
  editableProps: EditableProp[];   // mismo shape que ElementDefinition.editableProps
  render: {
    kind: "html-template";         // v1: solo plantillas seguras que el host escapa
    template: string;              // "…{{prop}}…" — el host interpola + escapa
    requiresEdgeEval?: boolean;    // problema 2
  };
  secretProps?: string[];          // problema 3: claves de props sensibles
}

interface ElementPack {
  name: string;                    // "portaless-plugin-paywall"
  version: string;
  elements: ContributedElement[];
}
```

- **Namespaced**: `paywall.Boundary` no puede colisionar con `Hero` ni con otro pack. Hace que el error "tipo desconocido" sea accionable.
- **Validado por schema puro** (`validateElementPack`), mismo estilo que `validateManifest` del sandbox.
- **Persistido** en `ElementPackStore` (D1 → SQLite → in-memory, espejo de `page-store.ts` / `plugin-registry/store-factory.ts`).
- **Resuelto** en `resolveCatalog(core, packs)` → un lookup `{ get(type), types(), palette() }` que es lo que leen render, validación, MCP y editor. El core sigue cerrado; el overlay es abierto.

### 2. Interceptación en el borde — dos modos de render

`renderPage(layout, { mode, dynamicRenderer? })`:

| Modo | Nodo `requiresEdgeEval` | Dónde corre |
|---|---|---|
| `"static"` (build) | Emite un placeholder fijo (`data-portaless-edge="<type>"` + nodeId) con fallback honesto en `<noscript>`. **Los bytes premium nunca entran en `dist/`.** | `astro build` / `src/pages/paginas/[slug].astro` |
| `"request"` (runtime) | El host lo resuelve vía el sandbox (`runPluginInProduction` / patrón `host-bridge` de commerce) tras el gate del propio plugin, e inlinea el HTML real. | `functions/paginas/[slug].js` |

Esto replica exactamente cómo `/paginas/[slug]` ya funciona (dinámico si hay function, fallback estático si no) y satisface la regla dura:

> **Regla dura (a)**: el contenido premium se renderiza **en el borde a request time**, nunca se commitea como HTML estático — los bytes estáticos premium son públicos en el repo y en cada deploy, así que ningún paywall puede protegerlos.

El punto de interceptación es el propio `renderPage`: recibe el modo y, en modo request, un `dynamicRenderer` que el caller (la function) provee. No hay un "hook" genérico de plugins en el render — hay un contrato explícito entre el render y quien tiene acceso al runtime.

### 3. Invisibilidad del secreto — por construcción, no por revisión

El renderer **estático** de un nodo `requiresEdgeEval` recibe **solo `{ type, nodeId }`** — no recibe `props`. No existe camino de código por el cual un valor de `secretProps` llegue a un artifact estático:

- El placeholder se construye sin acceder a `node.props` para los nodos edge-eval, en modo static.
- Los secretos viven solo en `pages.layout_json` (DB) — fuera de git y fuera de `dist/`.
- El editor los lee por el endpoint autenticado que ya existe (`GET/PUT /admin/pages/:slug`).
- `secretProps` documenta qué claves son sensibles para que el host pueda auditarlas, y un test/aserción de build verifica que ningún `dist/paginas/**/*.html` contenga el marcador que un valor sensible produciría.

**Regla dura (b)**, complementaria y ya decidida en el ROADMAP: el proveedor de billing lo elige el **operador** vía plugin con capability tokens; el núcleo no lleva billing.

## El circuito MCP

`ELEMENT_TYPE_LIST` (`packages/mcp-server/src/tools/element-node-schema.ts`) sigue derivándose de `Object.keys(elementRegistry)` **en tiempo de import**, pero solo para el **core**: los packs son DB-backed y no existen al importar, así que el membership de tipos se decide a **tiempo de call** contra el catálogo resuelto:

- `index.ts` resuelve el catálogo (core ∪ packs) una vez y lo pasa por `server.ts` a `list_page_components` y a las tools de contenido; cada invocación lo usa tal cual.
- El schema de un nodo acepta el enum core **o** cualquier string namespaced (`paquete.Element`), pero eso solo valida la *forma*; el membership real lo decide `checkNodeTypes`/`findUnknownTypes` contra el catálogo, con un error accionable que nombra los tipos fuera del catálogo.
- El test de paridad (`mcp-element-schema-parity.test.ts`) sigue exigiendo paridad del **core** (registry == palette == schema-core); los tipos de pack se validan aparte, contra el catálogo resuelto.

Resultado: el agente ve `paywall.Boundary` en `list_page_components` (con `source: "pack"`) y lo usa en `create_page` sin que `elementRegistry` ni `ElementType` cambien; un tipo namespaced que ningún pack provee produce un error de dominio, no un error de Zod.

## El editor

La paleta del editor se construye iterando el **catálogo resuelto** (`editor-app.ts`, `this.catalog.palette()`), cargado desde el endpoint admin (`GET /admin/api/element-packs`, que devuelve solo los packs; el cliente los fusiona con el core que ya viaja en su bundle vía `resolveCatalog`). Un elemento de pack se edita con el mismo panel de propiedades que uno core (mismo shape de `editableProps`), y su preview en el canvas usa el template interpolado por el host (`renderContributedTemplate`, exportado de `render.ts`). Un nodo de pack no está en `elementRegistry`, por eso el editor y el panel de propiedades ahora hacen lookup contra el catálogo (`entryView` / `renderPropertyPanel(..., catalog)`) en vez de contra el registro directo.

## Límites honestos (decididos, no descuidos)

1. **`render.kind` es `"html-template"` en v1.** No se ejecuta JS de plugin en el render. Un template que el host escapa no puede inyectar markup vivo; una `renderHTML` de plugin sí podría. Si algún día se necesita render imperativo, será un `kind` nuevo con su propio sandbox, no un relax de este.
2. **El gate de contenido premium lo pone el plugin, no el core.** El núcleo solo garantiza *dónde* se renderiza (borde, request time) y *qué no se filtra* (secretos, estático). Si un paywall-plugin olvida chequear, el contenido edge-eval igualmente no llega al estático — la protección de bytes es estructural, no depende del plugin.
3. **Los packs no aíslan código entre sí.** Cada pack es dato validado, no código en el catálogo. El código de un plugin corre donde ya corre hoy: en el sandbox de `plugin-sandbox` (isolated-vm / CF Workers), con capability tokens. Este diseño no cambia eso; solo define la frontera *dato* entre el catálogo y ese sandbox.
4. **La store de packs aún no tiene UI de instalación.** El slice la siembra en memoria/SQLite. La instalación de un pack por parte del operador (con consentimiento, al estilo del Permissions Center) es la pieza que faltaría para que esto sea operable sin tocar la DB a mano.

## Slice delgado (shipped, v0.0.9.11)

La primera pasada valida el circuito de punta a punta **sin secretos ni billing**:

- `ContributedElement` / `ElementPack` + `validateElementPack` (puro) — `elements/element-pack.ts`.
- `ElementPackStore` (in-memory + factory D1/SQLite) con un pack demo sembrado — `persistence/element-pack-store.ts` y `stores/{d1,sqlite}-element-pack-store.ts`, espejo del patrón `page-store`/`store-factory`. Tabla `element_packs` en `schema-additions/element-packs.sql`.
- `resolveCatalog(core, packs)` (puro) → `ResolvedCatalog` con `lookup`/`has`/`allTypes`/`packTypes`/`palette`.
- `renderPage(layout, { mode, catalog, dynamicRenderer })` con interpolación de template ( escapado) y placeholder estructural para `requiresEdgeEval` (modo `static` no toca `props`).
- `validatePageLayout(layout, catalog?)` con catálogo opcional (default: core); los `PageStore` ganan `setCatalog` y `createPageStore` cablea el catálogo best-effort.
- MCP resuelve el catálogo en call time (`index.ts` → `server.ts` → tools); el schema de nodos acepta tipos namespaced y el **membership real** lo decide `checkNodeTypes`/`findUnknownTypes` contra el catálogo. El pack demo es visible en `list_page_components` (`source: "pack"`) y usable en `create_page`/`insert_block`.
- Editor: `GET /admin/api/element-packs` + paleta/panel/preview sobre el catálogo resuelto.
- Un elemento demo `demo.Badge` (render de template, sin edge-eval) prueba la inyección end-to-end. Tests en `tests/unit/element-catalog-plugins.test.ts` (25 tests).

**Segunda pasada** (explícitamente fuera del slice): `requiresEdgeEval` end-to-end con el sandbox, `secretProps` con el guard de build, y la UI de instalación de packs.

## Archivos clave

- `packages/atomic-elements/src/elements/registry.ts:364-374` — el core cerrado.
- `packages/atomic-elements/src/types.ts:1-4, 30-43` — `ElementType` (unión cerrada) y `ElementDefinition`.
- `packages/atomic-elements/src/render.ts` — el lookup directo que gana modo/static.
- `packages/atomic-elements/src/persistence/page-schema.ts:13-22` — la validación que gana catálogo opcional.
- `packages/atomic-elements/src/persistence/page-store.ts` y `store-factory.ts` — el patrón de store multi-proveedor que replica `ElementPackStore`.
- `packages/plugin-sandbox/src/manifest/manifest-schema.ts` — el validador puro de manifest que replica `validateElementPack`.
- `packages/plugin-sandbox/src/registry/store-factory.ts:35-87` — el patrón de store en DB con seed-if-empty.
- `packages/commerce-plugin/src/host-bridge.ts` — el precedente host-holds-render / plugin-supplies-data.
- `packages/mcp-server/src/tools/element-node-schema.ts` y `tests/unit/mcp-element-schema-parity.test.ts` — la restricción de paridad que el overlay debe respetar.
