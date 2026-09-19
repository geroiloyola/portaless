# Sitios generados por agentes — flujo, documentación privada y Trust Layer

## Estado real

**PARCIALMENTE IMPLEMENTADO.** Este documento describe un flujo de 4 piezas. Las piezas 1 (elementos de Atomic Elements) y la declaración `content_kinds` de la pieza 2 ya son código real, mergeado en la rama `atomic-elements-design`. El resto (la tool MCP `create_creator_page` y el archivo `PROJECT_SKILL.md` generado por un agente) sigue siendo especificación de diseño, en el mismo espíritu que `docs/architecture/mcp-agents.md`, porque dependen de un servidor MCP que todavía es un stub sin lógica real.

## Problema que resuelve

Portaless puede convertirse en el destino natural de un caso de uso hoy dominado por plataformas cerradas de suscripción: un creador o influencer sin conocimiento técnico le pide a un agente de IA ("hazme una página con mis redes, mi tienda de afiliados y mi bio") y el agente construye el sitio completo usando Atomic Elements, sin que el creador toque código ni JSON.

Esto ya es parcialmente viable hoy: `mcp-agents.md` especifica `create_page`/`update_page` sobre `createPageStore` (confirmado y funcional en `store-factory.ts`), y el editor visual de Atomic Elements ya tiene los elementos base (`Hero`, `Button`, `Columns`, `ProductGrid`) más los 4 elementos nuevos de tipo "link en bio" (ver siguiente sección). Lo que falta es el contexto persistente del *por qué* de cada decisión, y una forma de que otros agentes (no solo el creador) sepan qué tipo de contenido trae el sitio antes de rastrearlo.

## Pieza 1: elementos de Atomic Elements estilo "link en bio" — IMPLEMENTADO

`packages/atomic-elements/src/elements/registry.ts` y `types.ts` ya incluyen 4 `ElementDefinition` nuevos, registrados en `elementRegistry` y `elementPalette` junto a los 8 elementos originales:

- **`LinkList`**: lista de botones (`label`/`url`/`icon`/`enabled`), con estilo `solid`/`outline` configurable.
- **`SocialIcons`**: fila de iconos de red social con alineación configurable.
- **`ProfileHeader`**: variante simplificada de `Hero` pensada para avatar + nombre + bio corta.
- **`StoreBlock`**: NO duplica el placeholder de `ProductGrid` — llama directamente `ProductGrid.renderHTML({ source: "manual", ... })`, coherente con que comercio hoy es solo lectura de catálogo (ver `AGENT.md`), sin necesitar checkout propio. Pensado para enlaces de afiliado.

Commits: `23e53e0` (types.ts), `8599b85` (registry.ts).

## Pieza 2: declaración de tipo de contenido — IMPLEMENTADO (campo), PENDIENTE (generación automática)

`packages/atomic-elements/src/seo/json-ld.ts` ya define `ContentKind` (`"commerce"`, `"affiliate"`, `"editorial"`, `"research"`, `"social_links"`, `"community"`) y el campo opcional `contentKinds` en `SiteInfo`. `buildJsonLd()` ya lo incluye como `additionalProperty` (`PropertyValue`) de la `Organization` cuando está declarado, sin afectar sitios existentes que no lo definan. Commit: `3c82793`.

Lo que sigue pendiente es la parte agentic: que un agente declare este campo automáticamente al crear el sitio (ver Pieza 4, todavía diseño).

### Relación con SiteTrustScore

Las 4 fuentes de confianza ya confirmadas (`self`, `agent`, `community`, `escrow_report`) siguen siendo la fuente de verdad sobre *si* confiar en el sitio. `content_kinds` es un campo distinto y complementario: no dice "es confiable", dice "esto es lo que declara traer" — la declaración honesta que otro agente necesita antes de decidir si vale la pena verificarla.

## Pieza 3: documentación privada por sitio (`.portaless/PROJECT_SKILL.md`) — DISEÑO, NO IMPLEMENTADO

Un archivo que un agente generaría automáticamente al crear o modificar un sitio, guardado junto al `PageLayout` del proyecto (mismo `PageStore` ya confirmado, no una base de datos nueva). Seguiría un formato abierto de instrucciones para agentes (frontmatter YAML + cuerpo en Markdown), ya adoptado como convención por varias herramientas de asistencia de código.

### Qué contendría

- **Frontmatter YAML**: `site_id`, `created_by` (identificador del agente, mismo formato Ed25519 que ya usa el `PermissionSubject` tipo `"agent"` confirmado en el Centro de Permisos), `created_at`, `budget_tier`.
- **Contexto original**: el prompt o brief que dio el admin humano, en sus propias palabras, sin reformular.
- **Decisiones de diseño**: qué elementos de `elementRegistry` se usaron y por qué.
- **Restricciones declaradas**: cualquier límite que el admin haya puesto.

### Quién podría verlo (mecanismo de acceso propuesto)

No introduciría un sistema de permisos nuevo. Reutilizaría el `PermissionStore` ya confirmado (`packages/permissions/src/permission-store.ts`) con una capacidad nueva del mismo catálogo de `CapabilityId`:

- `project_docs:read` — capacidad nueva, mismo patrón que las 12 ya existentes. Se concederia por defecto solo a dos `PermissionSubject`: el admin humano propietario del sitio, y el agente identificado como `created_by` en el frontmatter.
- Cualquier otro agente o subject que intentara leer este archivo vía una tool MCP futura (`read_project_skill`) fallaría explícitamente por falta de capacidad — mismo comportamiento que ya ocurre hoy en `node-isolated-vm.ts` con plugins sin capacidad concedida.
- El archivo viviría fuera de `src/content/pages/` (que es público por diseño) — se propone `.portaless/project-skill/<site_id>.md`, fuera del árbol servido públicamente por Astro.

Bloqueo actual: requiere que exista lógica de agente real generandolo, lo cual depende de la Pieza 4.

## Pieza 4: tool MCP `create_creator_page` — DISEÑO, NO IMPLEMENTADO

Especialización de la tool `create_page` ya prevista en `mcp-agents.md`. Tomaría un prompt corto del creador (ej. "vendo cursos de fitness, mis redes son X, Y, Z") y generaría un `PageLayout` completo usando los elementos de la Pieza 1 (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`), guardando además el `PROJECT_SKILL.md` de la Pieza 3 y declarando `contentKinds` en `SiteInfo` (Pieza 2).

Bloqueo actual: no existe servidor MCP real donde definir esta tool — `packages/mcp-server/` sigue siendo un stub (`README.md` + `package.json`), confirmado en `AGENT.md` y en `mcp-agents.md`. Esta pieza no puede pasar de diseño a código hasta que exista esa base.

## Flujo end-to-end propuesto (mezcla de código real y diseño pendiente)

1. Admin le da un brief corto a un agente de IA vía un cliente compatible con MCP.
2. El agente llama `create_creator_page` (Pieza 4, diseño) usando los elementos ya implementados de `elementRegistry` (Pieza 1, código real).
3. El agente genera `.portaless/project-skill/<site_id>.md` (Pieza 3, diseño) con el contexto y las decisiones tomadas, protegido por `project_docs:read`.
4. El agente declara `contentKinds` en `SiteInfo` (Pieza 2, campo ya implementado; declaración automática pendiente de la Pieza 4).
5. El admin revisa el borrador (aprobación humana obligatoria, mecanismo ya previsto en `mcp-agents.md`) y publica.
6. Cualquier agente externo que visite `/trust/[siteId]` ve `contentKinds` + el SiteTrustScore ya existente, sin necesitar leer el `PROJECT_SKILL.md` privado.

## Qué NO hace este diseño

No reemplaza ni compite con el `PermissionStore`, el Trust Layer, ni `createPageStore` — los consume tal cual existen. No introduce una base de datos nueva: el `PROJECT_SKILL.md` propuesto sería un archivo más gestionado por el mismo `PageStore`. No relaja el principio rector ya documentado en `mcp-agents.md` ("el humano define las reglas, el agente opera dentro de ellas") — la capacidad `project_docs:read` propuesta sigue el mismo modelo de concesión explícita que las 12 capacidades ya existentes.

## Dependencias (verificado en el repo)

| Pieza necesaria | Estado real confirmado |
|---|---|
| `createPageStore` / `PageStore` | Confirmado y funcional (`store-factory.ts`) |
| `PermissionStore` + `PermissionSubject` tipo `"agent"` | Confirmado, con registro de ejemplo real en el Centro de Permisos |
| `buildJsonLd()` / `SiteInfo` | Confirmado y funcional (commit `ec51d34`) |
| Trust Layer con lectura pública (`/trust/[siteId]`) | Confirmado, activo desde v0.0.9.3 |
| `ElementType`/`ElementDefinition` para LinkList/SocialIcons/ProfileHeader/StoreBlock | **Implementado** (commits `23e53e0`, `8599b85`) |
| Campo `contentKinds` en `SiteInfo` + `buildJsonLd()` | **Implementado** (commit `3c82793`) |
| Capacidad `project_docs:read` | No existe todavía — extensión propuesta al catálogo de `CapabilityId` |
| Formato `.portaless/project-skill/<site_id>.md` | No existe todavía — convención propuesta |
| Declaración automática de `contentKinds` por un agente | No existe todavía — depende de la tool `create_creator_page` |
| `mcp-server` / tool `create_creator_page` (requisito de las Piezas 3 y 4) | Stub sin implementar — ver `docs/architecture/mcp-agents.md` |

## Próximo paso recomendado

Con las Piezas 1 y 2 ya resueltas como código, el siguiente cuello de botella real es el mismo que identifica `mcp-agents.md` para todo el proyecto: la ausencia de un servidor MCP funcional. Antes de especificar `create_creator_page` con más detalle, tiene más sentido validar el patrón de conexión del mcp-server con una tool de solo lectura simple (ya sugerido en `mcp-agents.md`: `query_usage_log` o `list_installed_plugins`), y recién después construir `create_creator_page` sobre esa base ya probada.
