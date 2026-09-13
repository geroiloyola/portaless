# Roadmap de Portaless

## Leyenda
- [x] Resuelto y mergeado
- [~] Implementado, pendiente de merge o de integracion manual final
- [ ] Pendiente

## Alta prioridad
- [x] Proteger main + PR #1 y #2
- [x] Autenticacion basica (PR #4, mergeado)
- [~] Persistencia real Permisos + Trust Layer (D1/SQLite) - v0.0.6 (PR #5)
- [~] ProductGrid conectado a Medusa/Mercur - v0.0.6 (PR #5)
- [~] Adaptador isolated-vm ejecutando codigo real - v0.0.6 (PR #5)

## Prioridad media
- [~] SEO/GEO nativo (JSON-LD automatico + sitemap.xml + robots.txt) -- falta integrar 2 imports en [slug].astro, ver docs/architecture/seo-geo.md
- [~] Verificacion criptografica real de Web Bot Auth (RFC 9421, Ed25519)
- [~] Undo/redo + anidamiento visual en columnas dentro de Atomic Elements
- [~] Migrar src/commerce/ a un plugin sandboxeado real (NodeIsolatedVmAdapter)
- [~] canWrite(role) aplicado a todo el dashboard (guard DOM-level, ver packages/dashboard/docs/ROLE_GUARD.md para integracion de 1 linea + 1 atributo pendiente)
- [ ] Puentes de capacidades restantes en isolated-vm (9 de 12)
- [ ] Integracion real Cloudflare Workers for Platforms / Deno Deploy / Fastly Compute
- [ ] Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce
- [ ] Pool de isolates reutilizables para el commerce-plugin
- [ ] Reordenamiento por arrastre dentro de un mismo slot de columnas
- [ ] Validacion server-side explicita de canWrite(role) en cada endpoint de escritura

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
| #5 | agentic | Abierto (conflictos) | v0.0.6 |
| #6 | agentic | Abierto | v0.0.7: SEO/GEO, RFC 9421 real, undo/redo+nesting, commerce sandboxeado, role-guard |
