import { defineConfig } from "astro/config";

// Portaless se compila 100% a sitio estático (output: "static") para poder
// desplegarse en GitHub Pages o Cloudflare Pages sin necesidad de un runtime
// de servidor. Ajusta "site" y "base" según dónde publiques el sitio.
//
// compressHTML: true se fija explícito porque Astro 7 cambió su valor por
// defecto de true a "jsx" -- fijarlo evita que el upgrade de Astro 4 a 7
// (ver package.json) altere silenciosamente el espaciado del HTML generado
// en paginas ya publicadas.
//
// Los docs NO usan plugins del procesador de Markdown (Astro 7 ya no trae
// remark): src/lib/docs-loader.mjs reescribe los enlaces relativos ANTES de
// guardar el body (docs/i18n-design.md).
//
// REDIRECTS de las URLs legadas (Fase 3). El mapa unico vive en
// src/lib/routes.ts (LEGACY_ROUTES); la misma tabla cubre:
//   1. este build estatico: las redirecciones EMITIDAS son paginas meta-refresh
//      con canonical (lo unico posible en GitHub Pages). Las rutas estaticas de
//      contenido estan en src/pages/paginas/[slug].astro y
//      [locale]/paginas/[slug].astro; las raices del sistema son archivos dans
//      public/ con URL relativa (funcionan bajo cualquier base).
//   2. 301 reales en functions/_middleware.js (Cloudflare Pages),
//   3. el runtime Node de server/ (ejecuta el mismo middleware).
// /beta/ conserva su URL pero ahora es ingles (DEFAULT_LOCALE): aceptado.
export default defineConfig({
  output: "static",
  site: process.env.PORTALESS_SITE_URL || "https://tu-usuario.github.io",
  base: process.env.PORTALESS_BASE_PATH || "/",
  // outDir alterno para builds de verificacion (el sweep de enlaces construye
  // con la base de produccion sin pisar el dist/ que usa Playwright).
  outDir: process.env.PORTALESS_OUT_DIR || "./dist",
  compressHTML: true,
});
