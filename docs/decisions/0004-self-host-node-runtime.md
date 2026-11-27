# ADR-001: runtime Node 24 para self-hosted Portaless

- **Estado:** aceptado
- **Fecha:** 2026-09-30
- **Alcance:** PR A del soporte self-hosted; no incluye primer arranque ni Docker.

## Contexto
Portaless compila Astro con `output: "static"` y sus endpoints viven en `functions/` como Cloudflare Pages Functions. Cloudflare ejecuta esos módulos y sus `_middleware.js`; Node no lo hace por sí solo. Los stores SQLite, la migración y los handlers podían funcionar de forma aislada, pero faltaba un proceso HTTP de producción que sirviera `dist/` y compusiera las Functions con SQLite.

`wrangler pages dev` no resuelve el caso self-hosted: ejecuta workerd y workerd no carga `better-sqlite3`, que es un binario nativo.

## Decisión
Se implementa `server/node-runtime.mjs`, un dispatcher sin dependencias HTTP adicionales basado en `node:http` y las Web APIs nativas de Node 24. Descubre handlers, ejecuta middleware por prefijo, conserva `request/env/params/data/next`, sirve `dist/`, exige `PORTALESS_SQLITE_PATH` y expone `/healthz`.

## Alternativas descartadas
- **Express:** adaptación extra entre streams Node y Web APIs.
- **Hono:** dependencia adicional innecesaria.
- **Wrangler Pages local:** no carga better-sqlite3.
- **Astro SSR:** reescritura grande de handlers y middleware.

## Consecuencias
Los nuevos handlers se descubren sin editar una tabla de rutas. Cambios de semántica Pages Functions requieren tests del runtime. Login real + SQLite y primer arranque se amplían en PRs B/C.
