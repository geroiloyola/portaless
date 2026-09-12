# Roadmap de Portaless

Este documento es la fuente de verdad de qué está resuelto y qué falta,
priorizado para que el proyecto sea **funcional en un ciclo de 5 días**
(no "completo" — funcional: usable de forma segura para el caso de uso
principal, sin huecos obvios). Se actualiza cada vez que se cierra un PR
relevante. Ver `CHANGELOG.md` para el detalle histórico versión por versión.

## Leyenda

- [x] Resuelto y mergeado en `main`
- [~] Implementado, pendiente de mergear (ver PR referenciado)
- [ ] Pendiente

---

## 🔴 Alta prioridad (bloquea que el proyecto sea "funcional")

- [x] Proteger rama `main` + mergear PR #1 y PR #2
- [~] Sistema básico de roles y autenticación (login usuario/contraseña, roles admin/viewer, sin OAuth) — implementado en `packages/auth/` + `functions/admin/`, pendiente de mergear en **PR #4**
- [ ] Persistencia real del Centro de Permisos y del ledger del Trust Layer (SQLite o archivo JSON versionado) — **nota:** la autenticación ya tiene persistencia real (D1/SQLite vía `store-factory.ts`), pero permisos y ledger del Trust Layer siguen en memoria
- [ ] `ProductGrid` de Atomic Elements conectado de verdad a Medusa/Mercur
- [ ] Un adaptador de sandboxing ejecutando código real (recomendado: `isolated-vm` self-hosted, sin dependencia de credenciales de terceros)

## 🟡 Prioridad media (mejora sustancial, parcialmente alcanzable)

- [ ] SEO/GEO nativo básico (schema JSON-LD automático + `sitemap.xml`)
- [ ] Verificación criptográfica real de Web Bot Auth (RFC 9421) — hoy solo resuelve el directorio de claves, no valida la firma
- [ ] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements
- [ ] Migrar `src/commerce/` a un plugin sandboxeado real (hoy corre directo en el build de Astro)
- [ ] Aplicar `canWrite(role)` en todos los componentes de `packages/dashboard/` (hoy la utilidad existe pero no todos los componentes la consultan — un `viewer` puede llegar a ver controles que debería tener deshabilitados)

## ⚪ Baja prioridad / fuera de alcance de corto plazo

- [ ] Cobro real vía Pay per Crawl (integración con la API de AI Crawl Control de Cloudflare)
- [ ] MCP nativo (`packages/mcp-server/` sigue siendo un stub vacío)
- [ ] Identidad/comunidad AT Protocol (`packages/identity-atproto/` sigue siendo un stub vacío)
- [ ] Protocol APW resolver real (`packages/apw-resolver/` sigue siendo un stub vacío; el protocolo solo existe documentado en `docs/protocol-apw/apw-spec.md`)
- [ ] Agente raíz de lenguaje natural → sitio (depende de que Atomic Elements madure más como esquema de salida confiable)
- [ ] Recuperación de contraseña, 2FA, OAuth/SSO para el sistema de autenticación (explícitamente fuera de alcance del MVP actual)
- [ ] Automatizar la creación del admin inicial en Cloudflare D1 (hoy `create-admin.ts` genera el SQL, pero requiere ejecución manual con Wrangler)

## Visión de largo plazo (sin versión asignada, no bloquea nada del roadmap cercano)

- [ ] Lenguaje de programación de intención humana

---

## Pull Requests relevantes

| PR | Rama | Estado | Contenido |
|---|---|---|---|
| #1 | `chore/github-workflows` | ✅ Mergeado | `.gitignore`, workflows de CI/security, templates de issues |
| #2 | `docs/roadmap` | ✅ Mergeado | Este mismo `ROADMAP.md` (versión inicial) |
| #3 | `agentic` | ✅ Mergeado | `AGENT.md` |
| #4 | `agentic` | 🔶 Abierto, pendiente de revisión | Módulo `@portaless/auth` completo + persistencia real (D1/SQLite) + endpoint POST de login + script de admin inicial |

## Plan de 5 días (alta prioridad)

| Día | Objetivo | Estado |
|---|---|---|
| 1 | Mergear PR #1, activar protección de `main`, diseñar el esquema mínimo de autenticación | ✅ Hecho |
| 2 | Implementar login básico + persistencia real (SQLite/D1) para autenticación | ✅ Hecho (PR #4, pendiente merge) |
| 3 | Conectar `ProductGrid` a una instancia real de Medusa/Mercur | ⏳ Pendiente |
| 4 | Activar ejecución real del adaptador `isolated-vm` con al menos un plugin de prueba | ⏳ Pendiente |
| 5 | Colchón para bugs; si alcanza el tiempo, `sitemap.xml` + schema JSON-LD básico | ⏳ Pendiente |

## Cómo contribuir a este roadmap

Antes de abrir un PR de una nueva feature, verifica que no esté ya en
"Baja prioridad" por una razón documentada (usualmente dependencia de
otro componente que todavía no existe). Si tu PR resuelve un ítem de este
roadmap, marca el checkbox correspondiente (`[x]` si ya está mergeado en
`main`, `[~]` si está implementado pero pendiente de merge) en el mismo PR.
