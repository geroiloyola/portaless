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

## Publicación integrada desde el admin (C34)

`/admin/publish` y `GET|POST /admin/api/publication` orquestan la publicación
del **snapshot aprobado** (mapa `slug -> revisionId` + hash). El estado vive en
`publication_runs` (D1/SQLite) y contiene solo identificadores y resultado:
nunca contenido, tokens ni respuestas del proveedor.

- Publicar dos veces el mismo snapshot es idempotente.
- Un reintento solo puede reutilizar el snapshot con el que empezó; si una
  revisión aprobada cambió, responde `409 stale_publication_snapshot`.
- Despublicar reemplaza el árbol público controlado por un tombstone, sin tocar
  el canon privado ni los `publicationId`/`revisionId`.
- El proveedor se registra en la fila (`PORTALESS_PUBLISH_PROVIDER`); cambiar de
  GitHub Pages a Cloudflare no cambia el snapshot. Hoy el adaptador cableado es
  GitHub Pages; el runner es inyectable (`__PORTALESS_PUBLISH_RUNNER`) para
  pruebas y despliegues Node.

`functions/admin/api/*.js` en Cloudflare Pages corren en `workerd`, sin
`child_process` ni build tools. El endpoint responde `503
build_runtime_unavailable` ahí; el build real corre en el nodo self-hosted de
Node, que invoca `scripts/publish-site.mjs` con el snapshot esperado. El script
verifica el snapshot antes y después del build, así una aprobación concurrente
aborta sin tocar el proveedor.

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

## Límites actuales

- El adaptador cableado es GitHub Pages. Cloudflare Pages tiene validación de
  conexión (C35) pero todavía no un deployer de build propio; el snapshot es
  independiente del proveedor.
- Sin refresh automático del token OAuth (heredado de `github-oauth.ts`): si el
  token venció, el script falla explícito y pide reconectar.
- Solo repos de la cuenta personal del usuario (`/user/repos`), no
  organizaciones.
- No verificado contra una cuenta real de GitHub: cubierto por tests con
  `fetch` mockeado, mismo alcance que los adaptadores de Deno Deploy/Cloudflare
  Workers for Platforms.
