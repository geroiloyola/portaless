# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [x] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5, mergeado)
- [x] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5, mergeado)
- [x] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5, mergeado)

## Prioridad media
- [~] SEO/GEO nativo -- codigo mergeado (PR #5); falta pegar 2 imports en [slug].astro manualmente, ver docs/architecture/seo-geo.md
- [x] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519) - mergeado
- [x] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements - mergeado
- [x] Migrar src/commerce/ a un plugin sandboxeado real - mergeado
- [~] canWrite(role) aplicado a todo el dashboard -- guard DOM-level mergeado; validacion server-side agregada en UN endpoint de referencia (functions/admin/pages/[slug].js); falta replicar en el resto y confirmar _middleware.js
- [x] Test end-to-end del sandbox de plugins corriendo en CI
- [ ] Puentes de capacidades restantes en isolated-vm (9 de 12)
- [ ] Integracion real Cloudflare Workers for Platforms / Deno Deploy / Fastly Compute
- [ ] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce
- [ ] Pool de isolates reutilizables para el commerce-plugin
- [ ] Reordenamiento por arrastre dentro de un mismo slot de columnas
- [ ] Conectar la persistencia real (PageStore) dentro de functions/admin/pages/[slug].js
- [ ] Replicar la validacion server-side de canWrite(role) en el resto de endpoints de escritura

## Baja prioridad
- [ ] Cobro real Pay per Crawl
- [ ] MCP nativo
- [ ] Identidad AT Protocol
- [ ] Protocol APW resolver real
- [ ] Agente raiz de lenguaje natural
- [ ] Recuperacion contrasena, 2FA, OAuth/SSO
- [ ] Automatizar admin inicial en D1
- [ ] Comando unico schema.sql

## Vision largo plazo
- [ ] Lenguaje de programacion de intencion humana

## Pull Requests
| PR | Rama | Estado | Contenido |
|---|---|---|---|
| #1 | chore/github-workflows | Mergeado | gitignore, workflows |
| #2 | docs/roadmap | Mergeado | ROADMAP inicial |
| #3 | agentic | Mergeado | AGENT.md |
| #4 | agentic | Mergeado | auth + persistencia |
| #5 | agentic | Mergeado | v0.0.6 + v0.0.7 |
| #7 | (directo a main) | Este commit | Test E2E del sandbox en CI + validacion server-side de rol (referencia) |

## Tareas manuales pendientes

1. Pegar 2 imports (JsonLd + SeoHead) en src/pages/paginas/[slug].astro -- ver docs/architecture/seo-geo.md.
2. Confirmar que functions/admin/_middleware.js expone context.data.user -- ver docs/architecture/server-side-role-checks.md.
3. Conectar el PageStore real dentro de functions/admin/pages/[slug].js.
