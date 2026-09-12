# Portaless
## Whitepaper Técnico: Arquitectura para un CMS Descentralizado, Nativo en IA y Modular

**Versión 0.1 — Documento de diseño conceptual**
**Autor:** Linstark Corporation

> Nota: este documento se copió al repositorio en la adenda de estructura
> posterior a v0.0.5. El contenido corresponde al whitepaper original del
> proyecto; ver `CHANGELOG.md` para el estado real de implementación de
> cada componente descrito aquí (mucho de este documento es visión de
> producto, no código ya construido).

## 1. Resumen Ejecutivo

Portaless ("menos portales") es una propuesta de arquitectura para un CMS
de nueva generación que resuelve las limitaciones estructurales de
WordPress sin heredar su deuda técnica. Se organiza en cuatro capas
desacopladas: Contenido (motor serverless con sandboxing de plugins),
Generación/Edición (agentes de IA vía MCP con aprobación humana),
Identidad/Comunidad (AT Protocol) y Comercio (integración modular con
Medusa/Mercur).

## 2. Diagnóstico de WordPress

El 96% de las vulnerabilidades de WordPress se originan en plugins de
terceros con acceso irrestricto al núcleo. El costo de operar un sitio
WordPress con seguridad adecuada puede superar los 3.000 USD/mes. El
ecosistema de +60.000 plugins es, al mismo tiempo, el mayor activo y la
mayor debilidad de la plataforma.

## 3. Arquitectura de Portaless

- **Capa de Contenido**: sandboxing de plugins vía isolates (Dynamic
  Workers en Cloudflare, o equivalentes multi-proveedor — ver
  `packages/plugin-sandbox/` para el estado real de implementación).
- **Capa de Generación/Edición**: MCP como estándar de integración de
  agentes de IA, con cuota de tokens y aprobación humana obligatoria antes
  de publicar. **Estado real: no implementado, ver
  `docs/architecture/mcp-agents.md`.**
- **Capa de Identidad/Comunidad**: AT Protocol para comentarios y
  reputación portables entre sitios. **Estado real: no implementado, ver
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
este MVP, y `CHANGELOG.md` para el detalle version por version de qué se
implementó realmente frente a lo descrito en este whitepaper.
