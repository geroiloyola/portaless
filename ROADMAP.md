# Roadmap de Portaless

Este documento es la fuente de verdad de qué está resuelto y qué falta,
priorizado para que el proyecto sea **funcional en un ciclo de 5 días**
(no "completo" — funcional: usable de forma segura para el caso de uso
principal, sin huecos obvios). Se actualiza cada vez que se cierra un PR
relevante. Ver `CHANGELOG.md` para el detalle histórico versión por versión.

## Leyenda

- [x] Resuelto
- [ ] Pendiente

---

## 🔴 Alta prioridad (bloquea que el proyecto sea "funcional")

- [x] Proteger rama `main` + mergear PR #1
- [ ] Sistema básico de roles y autenticación (login de admin, usuario/contraseña, sin OAuth todavía)
- [ ] Persistencia real del Centro de Permisos y del ledger del Trust Layer (SQLite o archivo JSON versionado)
- [ ] `ProductGrid` de Atomic Elements conectado de verdad a Medusa/Mercur
- [ ] Un adaptador de sandboxing ejecutando código real (recomendado: `isolated-vm` self-hosted, sin dependencia de credenciales de terceros)

## 🟡 Prioridad media (mejora sustancial, parcialmente alcanzable)

- [ ] SEO/GEO nativo básico (schema JSON-LD automático + `sitemap.xml`)
- [ ] Verificación criptográfica real de Web Bot Auth (RFC 9421) — hoy solo resuelve el directorio de claves, no valida la firma
- [ ] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements
- [ ] Migrar `src/commerce/` a un plugin sandboxeado real (hoy corre directo en el build de Astro)

## ⚪ Baja prioridad / fuera de alcance de corto plazo

- [ ] Cobro real vía Pay per Crawl (integración con la API de AI Crawl Control de Cloudflare)
- [ ] MCP nativo (`packages/mcp-server/` sigue siendo un stub vacío)
- [ ] Identidad/comunidad AT Protocol (`packages/identity-atproto/` sigue siendo un stub vacío)
- [ ] Protocol APW resolver real (`packages/apw-resolver/` sigue siendo un stub vacío; el protocolo solo existe documentado en `docs/protocol-apw/apw-spec.md`)
- [ ] Agente raíz de lenguaje natural → sitio (depende de que Atomic Elements madure más como esquema de salida confiable)

## Visión de largo plazo (sin versión asignada, no bloquea nada del roadmap cercano)

- [ ] Lenguaje de programación de intención humana

---

## Plan de 5 días (alta prioridad)

| Día | Objetivo |
|---|---|
| 1 | Mergear PR #1, activar protección de `main`, diseñar el esquema mínimo de autenticación |
| 2 | Implementar login básico + persistencia real (SQLite) para permisos y ledger |
| 3 | Conectar `ProductGrid` a una instancia real de Medusa/Mercur |
| 4 | Activar ejecución real del adaptador `isolated-vm` con al menos un plugin de prueba |
| 5 | Colchón para bugs; si alcanza el tiempo, `sitemap.xml` + schema JSON-LD básico |

## Cómo contribuir a este roadmap

Antes de abrir un PR de una nueva feature, verifica que no esté ya en
"Baja prioridad" por una razón documentada (usualmente dependencia de
otro componente que todavía no existe). Si tu PR resuelve un ítem de este
roadmap, marca el checkbox correspondiente en el mismo PR.
