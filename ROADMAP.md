# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [~] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6
- [~] ProductGrid conectado a Medusa/Mercur - v0.0.6
- [~] Adaptador isolated-vm ejecutando codigo real - v0.0.6

## Prioridad media
- [ ] SEO/GEO nativo (schema JSON-LD + sitemap.xml)
- [ ] Verificacion criptografica real Web Bot Auth (RFC 9421)
- [ ] Undo/redo + anidamiento visual en columnas
- [ ] Migrar src/commerce/ a plugin sandboxeado real
- [ ] Aplicar canWrite(role) en todo el dashboard
- [ ] Puentes de capacidades restantes en isolated-vm (9 de 12)
- [ ] Integracion real Cloudflare/Deno Deploy/Fastly

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
| #5 | agentic | Abierto | v0.0.6 |

## Plan 5 dias
| Dia | Objetivo | Estado |
|---|---|---|
| 1 | Proteger main, disenar auth | Hecho |
| 2 | Login + persistencia auth | Hecho |
| 3 | ProductGrid a Medusa | Hecho (PR #5) |
| 4 | isolated-vm real | Hecho (PR #5) |
| 5 | Bugs, sitemap, schema | Pendiente |
