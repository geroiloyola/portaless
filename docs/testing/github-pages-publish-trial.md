# Ensayo de primera publicación real a GitHub Pages

Guion para la primera publicación real. No ejecutar publicaciones desde este documento; requiere aprobación del dueño y credenciales reales.

## Credenciales mínimas

- Repo propio (fork o propio) en GitHub.
- GitHub App/OAuth configurada según el Wizard (Paso 2).
- `PORTALESS_SQLITE_PATH` apuntando a la base real.
- `PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY`.
- `PORTALESS_SITE_URL` y, si aplica, `PORTALESS_BASE_PATH`.
- Contenido aprobado para publicación (sin drafts ni páginas privadas).

## Qué se publica

- Salida de `npm run publish`: vuelca páginas del PageStore, compila con Astro en un stage aislado y sube `dist/` al repo de GitHub Pages.
- Solo páginas publicables (`excludeDraftPages`, `isPubliclyPublishable`).
- Posts públicos y docs listados en `docs-nav`.
- No se publican: `.env`, `data/`, funciones `/.well-known/*`, endpoints admin, drafts, páginas privadas.

## Aprobación de snapshot

- `PORTALESS_PUBLISH_SNAPSHOT` permite verificar que las revisiones aprobadas no cambiaron entre el inicio y el build.
- Si cambió, el script aborta con `stale_publication_snapshot` sin desplegar.

## Desacople del PC

- La proyección queda en GitHub Pages y sigue disponible aunque el nodo se apague.
- El nodo canónico sigue siendo la fuente de verdad; la proyección es una copia.
- La despublicación se hace con `npm run publish -- --retire` (tombstone/retiro controlado).

## Despublicación con tombstone

- `retireStaticSite` retira la proyección controlada.
- Verificar que la URL pública deje de servir el contenido o muestre el estado retirado.

## Prueba de identidad con el nodo apagado (según A1f)

- `/.well-known/did.json`, `apw-manifest.jws`, `apw-log.json`, `apw-witnesses.json`, `apw-attestations.json` y `apw-index.json` son funciones, no archivos estáticos.
- Con el nodo apagado, la proyección estática de GitHub Pages **no** sirve esos endpoints.
- Por lo tanto, la identidad APW no se puede resolver desde la proyección estática con el nodo apagado.
- Esto es una limitación real del modelo de publicación actual y debe comunicarse así.

## Criterios de éxito

1. `npm run publish` termina sin error y reporta commit SHA y URL.
2. La URL pública muestra el contenido publicado.
3. `sitemap.xml`, `llms.txt`, `robots.txt` y RSS no mencionan contenido privado ni de demo.
4. La despublicación funciona y deja el estado esperado.
5. Se documenta que `/.well-known/*` no está disponible en la proyección estática.

## Criterios de parada

- Falta `PORTALESS_SQLITE_PATH` o `PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY`.
- `stale_publication_snapshot`.
- No hay páginas publicables.
- El build público falla.
- El token de GitHub no es válido o no se puede determinar el owner.
- Se detecta contenido privado en la proyección.

## Lo que no ejecutar

- No ejecutar publicaciones reales desde esta guía.
- No crear tags ni cambiar protecciones de GitHub.
- No fusionar PRs ni aprobar sin el dueño.
