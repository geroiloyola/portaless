# Desplegar Portaless en GitHub Pages (gratis)

1. Sube este proyecto a un repositorio de GitHub.
2. Ve a **Settings → Pages** y en "Build and deployment" selecciona
   **Source: GitHub Actions**.
3. (Opcional) Ve a **Settings → Environments → github-pages → Variables**
   o **Settings → Secrets and variables → Actions → Variables** y define:
   - `PORTALESS_SITE_URL`: la URL final de tu sitio, ej. `https://tu-usuario.github.io`.
   - `PORTALESS_BASE_PATH`: `/nombre-del-repo/` si el repo no es `tu-usuario.github.io`.
   - `ENABLE_COMMERCE`: `true` si quieres activar la tienda (ver `COMMERCE_SETUP.md`).
4. Haz `git push` a la rama `main`. El workflow en
   `.github/workflows/deploy-gh-pages.yml` construye el sitio y lo publica
   automáticamente.
5. Tu sitio queda disponible en la URL que configuraste, con HTTPS
   automático provisto por GitHub.

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
