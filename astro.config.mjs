import { defineConfig } from "astro/config";

// Portaless se compila 100% a sitio estático (output: "static") para poder
// desplegarse en GitHub Pages o Cloudflare Pages sin necesidad de un runtime
// de servidor. Ajusta "site" y "base" según dónde publiques el sitio.
//
// compressHTML: true se fija explícito porque Astro 7 cambió su valor por
// defecto de true a "jsx" -- fijarlo evita que el upgrade de Astro 4 a 7
// (ver package.json) altere silenciosamente el espaciado del HTML generado
// en paginas ya publicadas.
export default defineConfig({
  output: "static",
  site: process.env.PORTALESS_SITE_URL || "https://tu-usuario.github.io",
  base: process.env.PORTALESS_BASE_PATH || "/",
  compressHTML: true,
});
