# Desplegar Portaless en GitHub Pages (gratis)

1. Sube este proyecto a un repositorio de GitHub.
2. Ve a **Settings → Pages** y en "Build and deployment" selecciona
   **Source: GitHub Actions**.
3. (Opcional) Ve a **Settings → Environments → github-pages → Variables**
   o **Settings → Secrets and variables → Actions → Variables** y define:
   - `PORTALESS_SITE_URL`: la URL final de tu sitio, ej. `https://tu-usuario.github.io`.
   - `PORTALESS_BASE_PATH`: `/nombre-del-repo/` si el repo no es `tu-usuario.github.io`.
   - `ENABLE_COMMERCE`: `true` si quieres activar la tienda (ver `COMMERCE_SETUP.md`).
4. Crea `.github/workflows/deploy-pages.yml` en tu repositorio con este workflow mínimo listo para copiar y pegar (Node 24 + perfil limpio `starter` por defecto):

```yaml
name: Deploy Portaless to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci --no-audit --no-fund
      - name: Build static starter site
        env:
          PORTALESS_SITE_PROFILE: starter
          PORTALESS_SITE_URL: ${{ vars.PORTALESS_SITE_URL }}
          PORTALESS_BASE_PATH: ${{ vars.PORTALESS_BASE_PATH }}
          ENABLE_COMMERCE: ${{ vars.ENABLE_COMMERCE }}
        run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

   *(El demo oficial de Portaless se despliega aparte desde [`geroiloyola/portaless-templates`](https://github.com/geroiloyola/portaless-templates) en [geroiloyola.github.io/portaless-templates](https://geroiloyola.github.io/portaless-templates/).)*
5. Tu sitio queda disponible en la URL que configuraste, con HTTPS
   automático provisto por GitHub. Ten en cuenta que GitHub Pages sirve solo el
   sitio estático (sin `/admin`, sin base de datos y sin Trust Layer dinámico;
   ver [`architecture/runtime-parity-matrix.md`](./architecture/runtime-parity-matrix.md)).

## Dominio propio

Si quieres usar tu propio dominio en vez de `*.github.io`:

1. Agrega un archivo `public/CNAME` con tu dominio (ej. `midominio.com`).
2. En tu proveedor de DNS, crea los registros que indica la
   [documentación oficial de GitHub Pages para dominios personalizados](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
   (normalmente un registro `A`/`ALIAS` hacia la infraestructura de GitHub,
   o un `CNAME` si usas un subdominio).
3. Activa "Enforce HTTPS" en Settings → Pages una vez que el DNS propague.

Este es exactamente el patrón de "hosting delegado" descrito en el
documento del Protocol APW: tu dominio es tuyo, el hosting lo provee GitHub
gratis, y puedes migrarlo a otro proveedor cambiando solo los registros DNS.

## Actualizar (no hay base de datos)

GitHub Pages sirve solo el sitio estático: **no hay base que migrar**, así que
actualizar es traer los cambios del upstream. En un fork, copiá
[`examples/update-upstream.yml`](../examples/update-upstream.yml) a
`.github/workflows/` de tu repo: un botón manual (**Actions → Update upstream →
Run workflow**) abre un PR *"Update to vX"* desde el tag publicado más reciente
del upstream. Revisás el PR, corre el CI como filtro, y mergeás.

Si el contenido y el código viven en el mismo repo, el merge puede tocar tus
archivos: mantené tu contenido en `site-profiles/starter/**` y `public/**` y protegelos en
tu `.gitattributes` con `merge=ours` para que una actualización no los pise.

