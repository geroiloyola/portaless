# Motor de Despliegue: control plane self-hosted + vidriera estatica

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

1. Lee todas las paginas de `PageStore` (SQLite self-hosted) via `list()` +
   `load()`, y las vuelca a `src/content/pages/*.json` -- el formato que
   `src/pages/paginas/[slug].astro` ya sabe leer via `import.meta.glob`.
   **Salvaguarda**: por defecto excluye cualquier slug que termine en
   `-draft` (los borradores que genera el Paso 1 del Wizard) -- nunca se
   publica un borrador sin revisar. Ver `packages/deploy-engine/src/draft-filter.ts`.
2. Corre `astro build` de verdad (proceso Node real).
3. Sube el contenido completo de `dist/` a un repositorio de GitHub Pages
   usando la Git Data API (blob + tree + commit + ref), no la Contents API
   archivo por archivo -- evita el limite practico de requests en sitios
   con varias paginas. Ver `packages/deploy-engine/src/github-static-publish.ts`.
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
