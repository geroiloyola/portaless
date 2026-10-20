# Desplegar Portaless en Cloudflare Pages (gratis)

1. Sube este proyecto a un repositorio de GitHub o GitLab.
2. En el dashboard de Cloudflare, ve a **Workers & Pages → Create → Pages
   → Connect to Git** y selecciona tu repositorio.
3. Configura el build:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. En "Environment variables" agrega (si corresponde):
   - `PORTALESS_SITE_URL`
   - `ENABLE_COMMERCE`
5. Haz deploy. Cloudflare Pages construye y publica el sitio con SSL
   automático en un dominio `*.pages.dev`, y puedes agregar tu propio
   dominio desde **Custom domains** dentro del mismo proyecto de Pages.

## Ventaja frente a GitHub Pages

Cloudflare Pages permite además, a futuro, sumar **Cloudflare Workers**
para las partes dinámicas de Portaless (por ejemplo, el servidor MCP o el
sandboxing de plugins vía Dynamic Workers descritos en el whitepaper),
sin cambiar de proveedor. Es la ruta recomendada si planeas escalar más
allá de un sitio puramente estático.

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
