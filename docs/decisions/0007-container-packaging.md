# ADR-004 — Empaquetado en contenedor para self-hosting

- Estado: aceptado (PR C)

## Decisión

1. Dockerfile multi-stage sobre `node:24-bookworm-slim` en ambas etapas. `better-sqlite3` e `isolated-vm` (en `packages/plugin-sandbox`) son módulos nativos: se compilan en el builder, dentro de Linux, contra la misma glibc y la misma versión de Node que usa el runner. Alpine (musl) queda descartado.
2. `.dockerignore` excluye `node_modules` y `dist`: nunca se copian binarios del host.
3. El runner no es solo `dist/`. El runtime importa en ejecución `functions/`, `server/`, `scripts/`, `packages/*/src/*.ts` y `schema.sql`, así que se copia la app completa (sin tests, `.git` ni devDependencies). `node_modules` se copia entero desde el builder para conservar los symlinks de workspaces.
4. `tsx` pasa a `dependencies`: es el motor de ejecución de producción, no una herramienta de desarrollo. `npm start` ahora ejecuta `tsx scripts/start-docker.mjs`. Esto corrige el bug de PR A: con `node` directo fallaban los imports `.ts` sin extensión y las parameter properties de `site-identity-store.ts`.
5. Privilegios: Railway y Render montan los volúmenes como root. `scripts/docker-entrypoint.mjs` arranca como root, asigna `/data` a UID 1000 y lanza el servidor como ese usuario con `spawn({ uid, gid })`. No usa gosu ni su-exec y evita `RAILWAY_RUN_UID=0`.
6. Healthcheck con el `fetch` de Node contra `/healthz`: la imagen slim no trae `curl`.
7. El job `docker-smoke` del CI construye la imagen real y recorre arranque → setup → reinicio. También verifica que los archivos de `/data` pertenezcan a UID 1000 y que `SETUP_CODE.txt` tenga permisos 0600.

## Consecuencias

- `package-lock.json` tiene que regenerarse después de mover `tsx`, o `npm ci` falla en el builder.
- El proceso de Node que actúa como entrypoint sigue corriendo como root, pero solo reenvía señales: no carga código de la app ni lee secretos.
- Render exige un plan pago para tener disco persistente.
