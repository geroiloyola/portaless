# Portaless
## Whitepaper Técnico: Arquitectura para un CMS Descentralizado, Nativo en IA y Modular

**Versión 0.1 — Documento de diseño conceptual**
**Autor:** Gerardo Loyola

> **Estado de este documento (2026-10-15).** Es el **diseño original** del
> proyecto, conservado como registro de razonamiento — no como descripción
> de lo que existe hoy. Cada capa lleva su estado real anotado en línea, y
> los dos documentos que sí mandan son otros:
>
> - **[`docs/VISION.md`](../VISION.md)** — la dirección (qué debe llegar a
>   ser Portaless y qué no debe convertirse en). No lleva estado ni fechas.
> - **[`ROADMAP.md`](../../ROADMAP.md)** — el estado real y el trabajo que
>   falta, ítem por ítem. Donde este whitepaper discrepe con ellos, mandan
>   ellos.
>
> El **modelo técnico vigente** no vive aquí: vive en
> [`docs/architecture/`](../architecture/), un documento por área
> (`content-layer.md`, `persistence.md`, `authentication.md`,
> `mcp-agents.md`, `site-trust-score.md`, `identity-atproto.md`,
> `cloud-images.md`, `element-catalog-plugins.md`, `licensing-boundaries.md`,
> `ecosystem-boundaries.md`). Este archivo explica **por qué** el proyecto
> se diseñó así; esos explican **cómo** funciona hoy.

## 1. Resumen Ejecutivo

Portaless ("menos portales") es una propuesta de arquitectura para un CMS
de nueva generación que resuelve las limitaciones estructurales de
WordPress sin heredar su deuda técnica. Se organiza en cuatro capas
desacopladas: Contenido (motor serverless con sandboxing de plugins),
Generación/Edición (agentes de IA vía MCP con aprobación humana),
Identidad/Comunidad (AT Protocol) y Comercio (integración modular con
Medusa/Mercur).

## 2. Diagnóstico de WordPress

La gran mayoría de las vulnerabilidades de WordPress se originan en
plugins de terceros con acceso irrestricto al núcleo. El ecosistema de
+60.000 plugins es, al mismo tiempo, el mayor activo y la mayor
debilidad de la plataforma.

> **Nota sobre las cifras.** Este documento es de 2026 y las cifras que
> citaba al redactarse (~96% de vulnerabilidades originadas en plugins,
> costo de operación segura por encima de 3.000 USD/mes) **no llevan
> fuente inline**. No se reproducen aquí como si la tuvieran. La
> afirmación estructural — que un plugin con acceso irrestricto al núcleo
> es la superficie de mayor daño y el motivo de diseño del sandbox — se
> sostiene sola y no depende del número. Cualquier estadística que se
> publique sobre esto debe llevar su fuente al lado:
> es el mismo estándar que `VISION.md` exige ("un enunciado sin evidencia
> es un defecto, no marketing").

## 3. Arquitectura de Portaless

- **Capa de Contenido**: sandboxing de plugins vía isolates (Dynamic
  Workers en Cloudflare, o equivalentes multi-proveedor — ver
  `packages/plugin-sandbox/` para el estado real de implementación).
- **Capa de Generación/Edición**: MCP como estándar de integración de
  agentes de IA, con aprobación humana obligatoria antes de publicar.
  **Estado real (2026-10-15): implementado** — `packages/mcp-server/` expone
  7 herramientas reales sobre stores persistentes, con identidad de agente
  por invocación en el transporte HTTP y un gate humano que es la acción de
  publicar (toda escritura de agente queda en borrador). Lo que sigue sin
  implementar: la cuota de tokens, y la identidad por invocación sobre
  stdio (limitación del SDK) — ver `docs/architecture/mcp-agents.md`.
- **Capa de Identidad/Comunidad**: AT Protocol para comentarios y
  reputación portables entre sitios. **Estado real: el puente opcional
  APW <-> AT esta implementado (resolucion de handles, join de
  reputacion, `alsoKnownAs` en `did:apw`); los comentarios sobre un PDS
  propio siguen sin implementar — ver
  `docs/architecture/identity-atproto.md`.**
- **Capa de Comercio**: plugin sandboxeado que consume la Storefront API
  de Medusa/Mercur sin reimplementar checkout ni pagos. **Estado real:
  implementado parcialmente en `src/commerce/`, ver
  `docs/architecture/commerce-plugin.md`.**

## 4. Modelo de Versionado

Cada componente de Portaless mantiene su propio historial de versiones
inmutables, con despliegue gradual y reversión instantánea — inspirado en
el sistema de Versions & Deployments de Cloudflare Workers, pero pensado
para ser multi-proveedor.

## 5. Riesgos y Limitaciones

Ver `SECURITY.md` para los riesgos de seguridad activos y no resueltos de
este MVP, `ROADMAP.md` para el estado real ítem por ítem, y `CHANGELOG.md`
para el detalle version por version de qué se implementó realmente frente
a lo descrito en este whitepaper.

## 6. Qué de este documento sigue siendo el plan

El diseño de cuatro capas sigue en pie, y ninguna fue abandonada — pero
tres de ellas se materializaron de una forma que este documento no
anticipaba, y conviene decirlo acá para que nadie las busque como estaban
escritas:

| Capa del diseño original | Cómo se materializó |
|---|---|
| Contenido + sandboxing | Se construyó, y el sandbox dejó de ser "un detalle de la capa de contenido": hoy es un paquete propio con 4 adaptadores, catálogo de 12 capacidades atómicas, tokens efímeros con alcance por plugin, y un instalador que **no concede nada** al instalar. El comercio sigue viviendo en `src/commerce/` (lectura de catálogo), no detrás del sandbox. |
| Generación/Edición (MCP) | Implementado, con un matiz que este documento no describía: el gate humano no es una "cuota" sino el acto de publicar. Además, el modelo de identidad de agentes terminó siendo doble (HTTP por invocación, stdio por proceso) por una limitación real del SDK. |
| Identidad/Comunidad (AT Protocol) | AT Protocol quedó como **puente opcional** hacia APW, no como la capa de identidad. Lo que ocupa ese lugar es **Protocol APW**: identidad `did:apw`, atestaciones firmadas, testigos externos y un historial encadenado. Esta es la desviación más grande del documento, y es deliberada: la reputación portable necesita reglas verificables, no una red social como sustrato. Los comentarios sobre un PDS propio siguen sin implementar. |
| Comercio (Medusa/Mercur) | Implementado como consumidor de catálogo; el checkout nunca fue reimplementado. La decisión se endureció después: el core **nunca** cobra, y el pago pertenece a un proveedor o a un plugin. |

Desviación transversal, y la más importante: este documento imaginaba una
arquitectura; el proyecto terminó necesitando además un **protocolo** con
spec, errata y vectores ejecutables. Esa parte —`docs/protocol-apw/`— no
estaba en el whitepaper original, y hoy es el entregable que más crece.