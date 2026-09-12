import { defineConfig } from "astro/config";

// Portaless se compila 100% a sitio estático (output: "static") para poder
// desplegarse en GitHub Pages o Cloudflare Pages sin necesidad de un runtime
// de servidor. Ajusta "site" y "base" según dónde publiques el sitio.
export default defineConfig({
  output: "static",
  site: process.env.PORTALESS_SITE_URL || "https://tu-usuario.github.io",
  base: process.env.PORTALESS_BASE_PATH || "/",
});
