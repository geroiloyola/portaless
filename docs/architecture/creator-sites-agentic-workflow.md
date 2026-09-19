# Sitios generados por agentes — flujo, documentación privada y Trust Layer

## Estado real

**NO IMPLEMENTADO.** Este documento es una especificación de diseño, en el mismo espíritu que `docs/architecture/mcp-agents.md`: describe cómo deberían conectarse piezas que ya existen (`PageStore`, `PermissionStore`, Trust Layer) con un flujo nuevo, no introduce infraestructura paralela. No hay código construido todavía para ninguna sección de este documento — se marca explícitamente en cada pieza si depende de algo ya confirmado en el repo o de algo que sigue siendo diseño puro.

## Problema que resuelve

Portaless puede convertirse en el destino natural de un caso de uso hoy dominado por plataformas cerradas de suscripción: un creador o influencer sin conocimiento técnico le pide a un agente de IA ("hazme una página con mis redes, mi tienda de afiliados y mi bio") y el agente construye el sitio completo usando Atomic Elements, sin que el creador toque código ni JSON.

Esto ya es parcialmente viable hoy: `mcp-agents.md` especifica `create_page`/`update_page` sobre `createPageStore` (confirmado y funcional en `store-factory.ts`), y el editor visual de Atomic Elements ya tiene los elementos base (`Hero`, `Button`, `Columns`, `ProductGrid`). Lo que falta es el contexto persistente del *por qué* de cada decisión, y una forma de que otros agentes (no solo el creador) sepan qué tipo de contenido trae el sitio antes de rastrearlo.

## Pieza 1: documentación privada por sitio (`.portaless/PROJECT_SKILL.md`)

### Qué es

Un archivo generado automáticamente por el agente al crear o modificar un sitio, guardado junto al `PageLayout` del proyecto (mismo `PageStore` ya confirmado, no una base de datos nueva). Sigue un formato abierto de instrucciones para agentes (frontmatter YAML + cuerpo en Markdown), ya adoptado como convención por varias herramientas de asistencia de código — Portaless no inventa un formato propio, reutiliza uno que agentes externos ya saben leer e interpretar.

### Qué contiene

- **Frontmatter YAML**: `site_id`, `created_by` (identificador del agente, mismo formato Ed25519 que ya usa el `PermissionSubject` tipo `"agent"` confirmado en el Centro de Permisos), `created_at`, `budget_tier` (ej. `"low"`, para que un agente futuro que retome el proyecto respete la restricción original de "poco presupuesto").
- **Contexto original**: el prompt o brief que dio el admin humano, en sus propias palabras, sin reformular — para que cualquier agente que reabra el proyecto entienda la intención sin tener que volver a preguntarla.
- **Decisiones de diseño**: qué elementos de `elementRegistry` se usaron y por qué (ej. "se eligió `ProductGrid` con `source: manual` en vez de `medusa` porque el admin no tiene checkout propio, solo enlaces de afiliado").
- **Restricciones declaradas**: cualquier límite que el admin haya puesto (presupuesto, plataformas a excluir, tono de marca) — mismo espíritu que la cuota de tokens ya prevista en `mcp-agents.md`, pero a nivel de contenido/diseño en vez de costo de cómputo.

### Quién puede verlo (mecanismo de acceso)

No se introduce un sistema de permisos nuevo. Se reutiliza el `PermissionStore` ya confirmado (`packages/permissions/src/permission-store.ts`) con una capacidad nueva del mismo catálogo de `CapabilityId`:

- `project_docs:read` — capacidad nueva, mismo patrón que las 12 ya existentes (`content:read`, `site:admin`, etc.). Se concede por defecto solo a dos `PermissionSubject`: el admin humano propietario del sitio, y el agente identificado como `created_by` en el frontmatter.
- Cualquier otro agente o subject que intente leer este archivo vía una tool MCP futura (`read_project_skill`) debe fallar explícitamente por falta de capacidad — mismo comportamiento que ya ocurre hoy en `node-isolated-vm.ts` con plugins sin capacidad concedida.
- El archivo vive fuera de `src/content/pages/` (que es público por diseño, al ser el contenido del sitio en sí) — se propone `.portaless/project-skill/<site_id>.md`, fuera del árbol servido públicamente por Astro.

## Pieza 2: declaración de tipo de contenido para descubribilidad por agentes

### Qué es

Una extensión de `SiteInfo` (el mismo objeto que ya consume `buildJsonLd()`, confirmado en el commit `ec51d34` de este repo) con un campo nuevo `content_kinds: string[]`, con valores del vocabulario `"commerce"`, `"affiliate"`, `"editorial"`, `"research"`, `"social_links"`, `"community"`.

### Por qué en `SiteInfo` y no en un sistema nuevo

`SiteInfo` ya fluye hacia `buildJsonLd()` (structured data pública) y hacia el Trust Layer vía `src/pages/trust/[siteId].astro` (confirmado en los commits `4154a4e`, `a6c356d`). Agregar este campo ahí significa que:

- Un agente externo que visite `/trust/[siteId]` ve de inmediato qué tipo de contenido trae el sitio, sin tener que rastrear ni inferir desde el HTML.
- El JSON-LD ya generado por `buildJsonLd()` puede anotar el `@type` de Schema.org correspondiente (`Organization`, `Product`, `Article`) de forma coherente con `content_kinds`, reforzando la regla ya documentada en `CONTRIBUTING.md` de este repo: todo dato verificable por SiteTrustScore se genera desde el core, nunca desde un plugin de presentación.

### Relación con SiteTrustScore

Las 4 fuentes de confianza ya confirmadas (`self`, `agent`, `community`, `escrow_report`) siguen siendo la fuente de verdad sobre *si* confiar en el sitio. `content_kinds` es un campo distinto y complementario: no dice "es confiable", dice "esto es lo que declara traer" — la declaración honesta que otro agente necesita antes de decidir si vale la pena verificarla.

## Flujo end-to-end propuesto (todo el diseño depende de piezas no implementadas todavía)

1. Admin le da un brief corto a un agente de IA vía un cliente compatible con MCP.
2. El agente llama `create_page` (especificado, no implementado) usando elementos de `elementRegistry` — incluyendo los elementos de tipo "link en bio" propuestos en la conversación previa a este documento (`LinkList`, `SocialIcons`, `ProfileHeader`).
3. El agente genera `.portaless/project-skill/<site_id>.md` con el contexto y las decisiones tomadas, protegido por `project_docs:read`.
4. El agente declara `content_kinds` en `SiteInfo` según lo que el sitio realmente contiene.
5. El admin revisa el borrador (aprobación humana obligatoria, mecanismo ya previsto en `mcp-agents.md`) y publica.
6. Cualquier agente externo que visite `/trust/[siteId]` ve `content_kinds` + el SiteTrustScore ya existente, sin necesitar leer el `PROJECT_SKILL.md` privado (que sigue siendo exclusivo del admin y el agente creador).

## Qué NO hace este diseño

No reemplaza ni compite con el `PermissionStore`, el Trust Layer, ni `createPageStore` — los consume tal cual existen. No introduce una base de datos nueva: el `PROJECT_SKILL.md` es un archivo más gestionado por el mismo `PageStore`. No relaja el principio rector ya documentado en `mcp-agents.md` ("el humano define las reglas, el agente opera dentro de ellas") — la capacidad `project_docs:read` sigue el mismo modelo de concesión explícita que las 12 capacidades ya existentes.

## Dependencias (verificado en el repo)

| Pieza necesaria | Estado real confirmado |
|---|---|
| `createPageStore` / `PageStore` | Confirmado y funcional (`store-factory.ts`) |
| `PermissionStore` + `PermissionSubject` tipo `"agent"` | Confirmado, con registro de ejemplo real en el Centro de Permisos |
| `buildJsonLd()` / `SiteInfo` | Confirmado y funcional (commit `ec51d34`) |
| Trust Layer con lectura pública (`/trust/[siteId]`) | Confirmado, activo desde v0.0.9.3 |
| Capacidad `project_docs:read` | No existe todavía — extensión propuesta al catálogo de `CapabilityId` |
| Campo `content_kinds` en `SiteInfo` | No existe todavía — extensión propuesta |
| Formato `.portaless/project-skill/<site_id>.md` | No existe todavía — convención propuesta, basada en un formato abierto de instrucciones para agentes |
| `mcp-server` (requisito de todo el flujo) | Stub sin implementar — ver `docs/architecture/mcp-agents.md` |
| Elementos `LinkList`/`SocialIcons`/`ProfileHeader` en `elementRegistry` | No existen todavía — propuestos en conversación previa, no en este commit |

## Próximo paso recomendado

Igual que en `mcp-agents.md`, el camino de menor riesgo es no empezar por el flujo completo. Los dos cambios más pequeños y verificables primero: agregar `content_kinds` a `SiteInfo` (extensión de tipo, sin lógica nueva) y definir `project_docs:read` en el catálogo de capacidades (sin bridge todavía) — ambos son cambios aislados que no dependen de que el mcp-server exista, y sientan la base de datos antes de construir el flujo agentic completo sobre ellos.
