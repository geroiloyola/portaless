# Lessons learned: stores no equivalen a runtime self-hosted

**Fecha:** 2026-09-30

## Hallazgo
Tener `Sqlite*Store`, `schema.sql`, tests de handlers y un smoke de `npm run setup` no prueba que Portaless pueda atender tráfico HTTP fuera de Cloudflare Pages. Pages Functions necesita un runner; Astro está en modo estático y no ejecuta `functions/` en Node.

## Regla adoptada
Una afirmación de soporte self-hosted requiere al menos:

`HTTP real -> middleware -> cookie/sesión -> handler -> SQLite real -> reinicio`.

Los tests que invocan handlers directamente siguen siendo valiosos, pero no reemplazan ese recorrido.

## Prevención
- El runtime Node se prueba con rutas dinámicas, middleware anidado, `context.data`, status 405, headers y Set-Cookie.
- Producción exige `PORTALESS_SQLITE_PATH`; no debe caer a memoria en silencio.
- Setup de un solo uso, secretos persistidos y Docker se construyen después de validar el runtime HTTP.
