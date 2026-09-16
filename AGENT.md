# AGENT.md — Contexto para agentes de IA trabajando en Portaless

Este archivo existe para que cualquier agente de IA (Claude, GPT, Cursor,
o el que sea) tenga contexto inmediato del proyecto sin necesitar leer
todo el historial de commits, el whitepaper completo, o adivinar el
estado real de cada módulo. Léelo primero, siempre.

## Qué es Portaless en una frase

CMS ligero, open source, basado en Astro, pensado para desplegarse
sin hosting pagado (GitHub Pages / Cloudflare Pages), con módulos
opcionales de comercio, identificación de agentes de IA, sandboxing de
plugins y un dashboard modular — diseñado explícitamente para no repetir
los problemas estructurales de WordPress (plugins con acceso irrestricto,
theming complejo, sin control de scraping por IA). El core se licencia bajo
AGPL-3.0; el Plugin SDK se licencia aparte bajo MIT para no restringir a
los plugins de terceros (**nota:** `packages/plugin-sdk` todavia NO existe
como carpeta real en el monorepo -- hoy es diseno documentado en
`LICENSE-SDK` y `docs/architecture/licensing-boundaries.md`, sin codigo
construido) — ver ese documento para la frontera exacta prevista.

## Regla de oro antes de tocar cualquier código

**No asumas que algo funciona porque existe el archivo.** Este proyecto
documenta explícitamente, en el código y en `ROADMAP.md`, qué está
implementado de verdad y qué es un esqueleto con `TODO`. Antes de construir
sobre un módulo, verifica su estado real en la tabla de abajo.

## Mapa de estado real por módulo (ver ROADMAP.md para el detalle vivo)

| Módulo | Ubicación | Estado real |
|---|---|---|
| Motor de contenido (Astro) | `src/`, raíz del repo (NO `packages/core/` — ver `docs/architecture/REPO_STRUCTURE_MAP.md`) | ✅ Funcional |
| Comercio (Medusa/Mercur) | `src/commerce/` | ✅ Funcional (solo lectura de catálogo, sin checkout propio) |
| Atomic Elements (editor visual) | `packages/atomic-elements/` | ✅ Funcional, con undo/redo y anidamiento visual en columnas |
| Dashboard + Skin System | `packages/dashboard/` | ✅ Funcional |
| Autenticación / roles de usuario | `packages/auth/` | ✅ Funcional: usuario/contraseña, roles admin/viewer, MFA/TOTP, recuperación de contraseña, OAuth/SSO (`AuthService`). Guard server-side confirmado en el dashboard. |
| Centro de Permisos | `packages/permissions/` | ✅ UI funcional con persistencia real (D1PermissionStore/SqlitePermissionStore), endpoints conectados |
| Trust Layer (Web Bot Auth) | `packages/trust-layer/` | ✅ Resuelve directorio de claves Y valida firma criptográfica (RFC 9421, Ed25519), con cache de directorio y verificación de unicidad de nonce contra replay |
| Sandboxing de plugins | `packages/plugin-sandbox/` | ✅ Adaptador `isolated-vm` self-hosted ejecuta código real, con las 12/12 capacidades del catálogo con puente real vía `ivm.Reference` y pool de isolates reutilizables. Protección activa contra CVE conocida (GHSA-864f-rcv7-6rh4) |
| Comercio como plugin sandboxeado | `packages/commerce-plugin/` | ✅ Migrado a plugin real ejecutado dentro del sandbox (`isolated-vm` self-hosted), ya no solo manifiesto de referencia |
| Ledger público de trazabilidad | `packages/trust-layer/src/ledger` | ✅ Persistencia real, lado de escritura y lectura pública conectados |
| MCP server | `packages/mcp-server/` | ❌ Stub sin lógica de servidor MCP real — ver `docs/architecture/mcp-agents.md` para la especificación completa del diseño previsto |
| Identidad AT Protocol | `packages/identity-atproto/` | ❌ Stub vacío, sin lógica |
| Protocol APW resolver | `packages/apw-resolver/` | ❌ Stub vacío, solo documentado en `docs/protocol-apw/apw-spec.md` |
| Plugin SDK | `packages/plugin-sdk/` (no existe todavia) | ❌ Solo diseño/licencia (`LICENSE-SDK`, `docs/architecture/licensing-boundaries.md`) -- ningun codigo construido todavia |

## Dónde está cada documento importante

- `ROADMAP.md` — checklist priorizado (alto/medio/bajo) de qué falta. **Lee esto antes de proponer una feature nueva.**
- `CHANGELOG.md` — historial real, versión por versión, de qué se implementó.
- `SECURITY.md` — vulnerabilidades conocidas y activas (incluye la CVE real de `isolated-vm`, GHSA-864f-rcv7-6rh4).
- `docs/architecture/REPO_STRUCTURE_MAP.md` — por qué la estructura real del repo difiere de la propuesta original, y dónde está cada cosa de verdad.
- `docs/architecture/licensing-boundaries.md` — frontera exacta entre el core AGPL-3.0, el Plugin SDK en MIT (diseño, aun no implementado), y los proyectos/plugins de terceros.
- `docs/architecture/mcp-agents.md` — especificación completa (no implementación) del servidor MCP previsto para agentes de IA.
- `docs/whitepaper/portaless-whitepaper.md` — visión de producto completa (nota: mucho de este documento es diseño, no código construido — cruzar siempre con la tabla de estado real arriba).
- `docs/protocol-apw/apw-spec.md` — diseño del Protocol APW (no implementado).
- `CONTRIBUTING.md` — cómo proponer cambios.

## Convenciones de código que este proyecto sigue estrictamente

1. **Todo módulo nuevo es opcional por defecto.** Activar comercio, Trust Layer, o sandboxing nunca debe romper el sitio si el módulo está desactivado. Ver el patrón `ENABLE_COMMERCE` / `ENABLE_TRUST_LAYER` en `functions/_middleware.js` y `astro.config.mjs`.
2. **Ningún plugin recibe más capacidades de las concedidas explícitamente.** La regla vive en `packages/plugin-sandbox/src/runtime/sandbox-runtime.ts`: siempre se usa lo *concedido* por el Centro de Permisos, nunca lo *solicitado* en el manifiesto del plugin.
3. **Todo manifiesto de plugin declara capacidades atómicas con una razón legible.** Ver el catálogo completo en `packages/plugin-sandbox/src/capabilities/capability-registry.ts`.
4. **Nunca declarar algo como "implementado" si tiene un TODO de integración real pendiente.** Este proyecto prioriza documentar honestamente las limitaciones sobre aparentar funcionalidad — mantén ese estándar en cualquier código o documentación que agregues.
5. **Todo cambio va en la rama única `agentic`, nunca commit directo a `main`.** Este repositorio usa UNA sola rama de trabajo para cambios agentic; no crear ramas nuevas por feature salvo instrucción explícita del dueño del proyecto.
6. **La única superficie que un plugin de terceros podra importar es el futuro `packages/plugin-sdk`** (aun no existe como codigo -- ver nota en la seccion anterior). Mientras tanto, ningun plugin debe importar directamente modulos internos del core — toda comunicacion pasa por el capability bridge (`ivm.Reference` + `hostBridge`).

## Flujo de trabajo esperado de un agente en este repo

1. Lee `ROADMAP.md` para saber qué prioridad atacar.
2. Verifica el estado real del módulo afectado en la tabla de este archivo — no confíes solo en el nombre de la carpeta.
3. Sube los cambios a la rama única `agentic` (no crear ramas nuevas).
4. Implementa el cambio, incluyendo un test en `tests/unit/` o `tests/e2e/` si resuelve un `TODO`.
5. Actualiza `CHANGELOG.md` y marca el checkbox correspondiente en `ROADMAP.md` si aplica.
6. Abre o actualiza el Pull Request desde `agentic` hacia `main` — nunca mergees directo, incluso si tienes permisos técnicos para hacerlo. El dueño del proyecto aprueba manualmente.

## Riesgos de seguridad activos que cualquier agente debe conocer antes de tocar estos módulos

- `isolated-vm` (adaptador self-hosted de sandboxing): versiones ≤7.0.0 son vulnerables a RCE (GHSA-864f-rcv7-6rh4). El código ya rechaza versiones vulnerables al instanciar — no elimines esa verificación.
- El Centro de Permisos y el ledger de trazabilidad ya tienen persistencia real conectada — no trates sus datos como descartables entre despliegues.

## Stack técnico de referencia

Astro 4.x + TypeScript, sin framework de UI pesado (los organismos del
dashboard y los elementos de Atomic Elements se renderizan a DOM/HTML
directo, sin React/Vue). Monorepo con npm workspaces (`packages/*`).
Despliegue objetivo: GitHub Pages o Cloudflare Pages, sin servidor propio
para el caso de uso base.
