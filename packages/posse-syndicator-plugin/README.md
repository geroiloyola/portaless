# @portaless/posse-syndicator-plugin

Plugin oficial de sindicación **POSSE** (*Publish on Own Site, Syndicate Everywhere*) para Portaless.

## Filosofía

1. **El Canon es Soberano**: Todo el contenido nace primero en el repositorio Git en `/posts/` (`src/content/posts/*.md`).
2. **Espejos Descentralizados**: Las redes sociales (Bluesky vía AT Protocol, Mastodon vía ActivityPub) actúan como espejos de distribución efímeros que siempre enlazan de vuelta a la URL canónica de la publicación.
3. **Sandbox Aislado**: El plugin corre dentro de `isolated-vm` bajo el gobierno del Centro de Permisos de Portaless (`/admin/permissions`). Requiere explícitamente:
   - `content:read`: Para leer título, extracto y slug de las publicaciones.
   - `network:fetch`: Limitado a los hosts de las redes federadas autorizadas (`bsky.social`, `mastodon.social`).
