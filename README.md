# Portaless

**Portaless** ("menos portales") es un CMS ligero, open source, construido sobre [Astro](https://astro.build), pensado para levantarse **sin hosting pagado** usando GitHub Pages o Cloudflare Pages, con un módulo de comercio **opcional** compatible con [Medusa](https://medusajs.com) / [Mercur](https://mercurjs.com).

Este repositorio es el MVP inicial del proyecto. Es la primera implementación de referencia de las ideas descritas en el whitepaper de Portaless y del Protocol APW (Air Portal Websites).

## Filosofía del proyecto

- **Sin servidor propio.** El sitio se compila a HTML/CSS/JS estático y se sirve desde un host gratuito (GitHub Pages, Cloudflare Pages). No hay base de datos que administrar ni PHP que parchear.
- **Comercio opcional, no obligatorio.** Igual que WooCommerce es un plugin sobre WordPress y no una obligación, el módulo de comercio de Portaless es una capa opcional que consume la API de una tienda Medusa/Mercur ya existente. Portaless nunca reimplementa carrito, checkout ni pagos.
- **Editar a mano siempre disponible.** El contenido vive en Markdown/JSON dentro del repo. Cualquier agente de IA (vía MCP, en fases futuras) puede proponer cambios, pero el contenido final siempre es texto plano editable por un humano en cualquier editor.
- **Licencia MIT.** Úsalo, modifícalo, bifúrcalo, vende servicios sobre él. Sin restricciones de copyleft.

## Estructura del proyecto

```
portaless-mvp/
├── src/
│   ├── layouts/          # Layout base del sitio
│   ├── pages/            # Rutas del sitio (home, blog, tienda)
│   ├── content/posts/    # Contenido en Markdown (colecciones de Astro)
│   ├── components/       # Componentes reutilizables (Header, Footer, ProductCard)
│   ├── commerce/         # Cliente ligero para la Storefront API de Medusa (opcional)
│   └── styles/           # CSS global
├── docs/                 # Guías de despliegue y configuración
├── .github/workflows/    # CI/CD para GitHub Pages
└── scripts/              # Notas sobre Protocol APW (DNS, DNSLink, did:web)
```

## Cómo levantar el proyecto localmente

```bash
npm install
npm run dev
```

Abre `http://localhost:4321`.

## Cómo desplegar gratis

- **GitHub Pages:** ver [`docs/DEPLOY_GITHUB_PAGES.md`](docs/DEPLOY_GITHUB_PAGES.md). El workflow en `.github/workflows/deploy-gh-pages.yml` ya está listo — solo activa GitHub Pages en la configuración del repo (Settings → Pages → Source: GitHub Actions).
- **Cloudflare Pages:** ver [`docs/DEPLOY_CLOUDFLARE_PAGES.md`](docs/DEPLOY_CLOUDFLARE_PAGES.md). Conecta el repo directamente desde el dashboard de Cloudflare Pages, sin configuración adicional.

Ambos son gratuitos para proyectos de este tamaño y sirven el sitio con SSL automático.

## Cómo activar el módulo de comercio (opcional)

Portaless **no** trae una tienda propia. Si quieres vender productos, necesitas:

1. Una instancia de Medusa (self-hosted o en la nube) o de Mercur corriendo por separado.
2. Copiar `src/commerce/config.example.ts` a `src/commerce/config.ts` y poner la URL pública de tu Storefront API.
3. Poner `ENABLE_COMMERCE=true` en tus variables de entorno de build.
4. La ruta `/tienda` aparecerá automáticamente listando los productos que devuelva tu instancia de Medusa/Mercur.

Ver la guía completa en [`docs/COMMERCE_SETUP.md`](docs/COMMERCE_SETUP.md).

Si `ENABLE_COMMERCE` no está activado, la ruta `/tienda` simplemente no se genera — el sitio queda 100% estático sin ninguna dependencia de comercio, exactamente como un WordPress sin WooCommerce instalado.

## Protocol APW (nota de diseño)

Este MVP no implementa todavía la capa de control DNS (DNSLink + did:web) descrita en el documento del Protocol APW. Ver `scripts/apw-notes.md` para el diseño planeado y cómo se irá integrando en versiones futuras, una vez que el producto esté validado en producción con sitios reales.

## Roadmap posterior a este MVP

- [ ] Sandboxing de plugins vía Dynamic Workers (Cloudflare) para extensiones de terceros.
- [ ] Servidor MCP nativo para edición asistida por agentes de IA con aprobación humana.
- [ ] Capa de identidad/comunidad vía AT Protocol (comentarios portables).
- [ ] Resolver de Protocol APW (DNSLink + did:web) como modo de despliegue alternativo.

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
