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

En Cloudflare los datos viven en **D1**. La primera vez aplica el esquema; al
actualizar, aplica las migraciones numeradas (el contrato de datos que también
usa el self-host):

```bash
# Primera vez (o al regenerar el esquema):
npx wrangler d1 execute <DB_NAME> --file=schema.sql --remote

# Actualizar a un tag nuevo: aplica las migraciones numeradas.
npx wrangler d1 migrations apply <DB_NAME> --remote
```

El core es fail-closed: si la base quedara más nueva que el código, el arranque
se niega en lugar de degradar el schema. La sección **Migration** del
[`CHANGELOG`](../CHANGELOG.md) resume el flujo por tipo de despliegue.

