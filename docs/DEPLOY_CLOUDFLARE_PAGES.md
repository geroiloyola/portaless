# Desplegar Portaless en Cloudflare Pages (gratis)

1. Sube este proyecto a un repositorio de GitHub o GitLab.
2. En el dashboard de Cloudflare, ve a **Workers & Pages → Create → Pages
   → Connect to Git** y selecciona tu repositorio.
3. Configura el build:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. En "Environment variables" agrega (si corresponde):
   - `PORTALESS_PUBLIC_URL` — **obligatoria** en producción: el origen HTTPS
     real (`https://tu-dominio.example`). CSRF, `.well-known` y OAuth la usan
     como única fuente de verdad; no se deriva del header `Host`.
   - `PORTALESS_SITE_URL`
   - `PORTALESS_BASE_PATH` (solo si sirves el sitio bajo un subpath)
   - `ENABLE_COMMERCE` / `ENABLE_TRUST_LAYER`
   - `IP_HASH_SALT` si usas votos comunitarios
   - `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` para la identidad `did:apw`
   - el binding D1 `DB` para login, admin, permisos y Trust Layer
5. Haz deploy. Cloudflare Pages construye y publica el sitio con SSL
   automático en un dominio `*.pages.dev`, y puedes agregar tu propio
   dominio desde **Custom domains** dentro del mismo proyecto de Pages.

## Qué corre en Cloudflare Pages

Cloudflare Pages ejecuta las `functions/` de Portaless: login, admin, Trust
Layer, endpoints MCP HTTP y APIs administrativas, con D1 como persistencia.
No ejecuta el build de publicación: el nodo canónico y `/admin/publish`
necesitan Node self-hosted, porque `workerd` no tiene `child_process` ni
build tools. En Cloudflare, `POST /admin/api/publication` responde
`503 build_runtime_unavailable` en lugar de fingir una publicación.

Para publicar desde la UI, mantené el nodo canónico en self-hosted Node y usá
Cloudflare Pages solo como proyección pública/funciones, o ejecutá el publisher
en ese nodo. La identidad del snapshot es independiente del proveedor.

El servidor MCP HTTP y el sandbox de plugins son procesos/adaptadores aparte;
no se levantan automáticamente por desplegar Pages. Ver
[`docs/private-node.md`](./private-node.md) y
[`docs/testing/release-acceptance.md`](./testing/release-acceptance.md).

## D1: esquema y migraciones

En Cloudflare los datos viven en **D1**. `setup:d1` aplica `schema.sql` solo a
una base vacía. Para actualizar una existente, `migrate:d1` exporta un backup,
lee el ledger y el esquema real, aplica los deltas numerados en orden y registra
cada versión solo después de ejecutarla:

```bash
# Primera vez: crea schema + ledger comprobado + admin inicial.
npm run setup:d1 -- --db <DB_NAME> --remote

# Actualización; --dry-run valida estado y muestra los deltas sin escribir.
npm run migrate:d1 -- --db <DB_NAME> --remote
npm run migrate:d1 -- --db <DB_NAME> --remote --dry-run
```

El backup D1 queda en `backups/d1/`. Las bases sin ledger solo se adoptan si
verifican todas las columnas del contrato actual; una base incompleta se bloquea
y no puede declararse actual mediante un estampado manual.

El core es fail-closed: si la base quedara más nueva que el código, el arranque
se niega en lugar de degradar el schema. La sección **Migration** del
[`CHANGELOG`](../CHANGELOG.md) resume el flujo por tipo de despliegue.
