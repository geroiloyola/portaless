# Motor de Despliegue: control plane self-hosted + vidriera estatica

> **Contrato actualizado:** [`canonical-node-and-public-projections.md`](./canonical-node-and-public-projections.md)
> define el nodo canónico privado como local **o** alojado en un servicio privado
> como Cloudum. Este documento describe el flujo de publicación que existe hoy;
> no implica que Cloudum, la aprobación desde UI o la sincronización del nodo
> estén implementados. El `publish` actual es un CLI self-hosted y requiere
> terminal.

## Decision de arquitectura

Portaless (el editor, el sandbox, el MCP server, la identidad `did:apw`, los
permisos) es el **control plane**: vive self-hosted, donde el creador decida
-- su propio servidor, su VPS, su laptop. Nunca necesita exponerse
publicamente para que el sitio funcione. Es el mismo principio que separa el
coordination server de Tailscale del trafico real entre dispositivos: el
coordination server nunca ve ni retransmite los datos, solo coordina
identidad y politicas.

GitHub Pages (u otro hosting estatico) es el **data plane**: una vidriera
publica, dumb, sin secretos, sin rutas de admin, sin Functions de servidor.
Lo unico que recibe es el resultado YA COMPILADO de `astro build` -- nunca
el codigo fuente de Portaless, nunca `functions/`, nunca el editor.

## Por que no es un boton del navegador

`functions/admin/api/*.js` son Cloudflare Pages Functions: corren en runtime
edge (`workerd`), sin `child_process` ni herramientas de build de Node --
ni en produccion ni en local con Wrangler. Ahi no se puede compilar el
sitio. Por eso `scripts/publish-site.mjs` es un CLI de Node corrido a mano
por el admin self-hosted, mismo patron que `scripts/setup.mjs` y
`scripts/onboard-agent.mjs`.

## Que hace `npm run publish`

1. Lee las paginas de `PageStore` (SQLite self-hosted) via `list()` + `load()`.
   La politica central `isPubliclyPublishable()` excluye `draft`, `private`,
   estados desconocidos y el sufijo legacy `-draft`; no hay flag para saltarla.
2. Construye un directorio temporal desde una allowlist de inputs Astro
   (`src/`, `public/`, código fuente de `packages/`, metadatos npm requeridos y
   los docs declarados en `docs-nav.mjs`); no copia `functions/`, `server/`,
   tests, `.airchive/`, DBs, backups ni archivos raíz desconocidos. Vuelve a
   incluir solo páginas/posts fuente publicables; un slug privado de PageStore
   bloquea cualquier fixture equivalente, y los layouts públicos de PageStore
   sustituyen la primaria fuente. Ejecuta `astro build` ahí; el árbol canónico
   no se modifica, al proceso hijo solo pasan variables de build allowlisted y
   solo `dist/` forma la proyección.
3. Sube el contenido completo de `dist/` a un repositorio de GitHub Pages
   usando la Git Data API (blob + tree + commit + ref), no la Contents API
   archivo por archivo -- evita el limite practico de requests en sitios
   con varias paginas. Cada publicación crea un árbol completo sin `base_tree`,
   por lo que los artefactos que ya no están en `dist/` se retiran; el ref avanza
   sin force-push. Ver `packages/deploy-engine/src/github-static-publish.ts`.
4. Crea el repositorio si no existe (por defecto `{usuario}.github.io`,
   convencion de GitHub Pages de usuario) y activa Pages si no estaba
   activado (idempotente).

## Pendiente, no resuelto por esta tarea

- No hay boton ni endpoint HTTP que dispare esto desde el Wizard -- la UI
  todavia no muestra la instruccion `npm run publish` (requiere editar
  `step-2-infrastructure.astro`, no modificado en esta tarea).
- Sin refresh automatico del token OAuth (heredado de `github-oauth.ts`):
  si el token vencio, el script falla explicito y pide reconectar.
- Solo repos de la cuenta personal del usuario (`/user/repos`), no
  organizaciones.
- No verificado contra una cuenta real de GitHub -- cubierto solo por tests
  con `fetch` mockeado, mismo alcance que los adaptadores de Deno
  Deploy/Cloudflare Workers for Platforms.
