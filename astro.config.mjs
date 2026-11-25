import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { getSiteProfileConfig } from "./src/lib/site-profile.mjs";

const siteProfile = getSiteProfileConfig(process.env);

const DEMO_ONLY_ROUTES = [
  { pattern: "/beta", entrypoint: "./src/profile-pages/demo/beta.astro" },
  { pattern: "/docs", entrypoint: "./src/profile-pages/demo/docs/index.astro" },
  { pattern: "/projections", entrypoint: "./src/profile-pages/demo/projections.astro" },
  { pattern: "/shop", entrypoint: "./src/profile-pages/demo/shop/index.astro" },
  { pattern: "/es", entrypoint: "./src/profile-pages/demo/es/index.astro" },
  { pattern: "/es/beta", entrypoint: "./src/profile-pages/demo/es/beta.astro" },
  { pattern: "/es/explore", entrypoint: "./src/profile-pages/demo/es/explore.astro" },
  { pattern: "/es/projections", entrypoint: "./src/profile-pages/demo/es/projections.astro" },
  { pattern: "/es/shop", entrypoint: "./src/profile-pages/demo/es/shop/index.astro" },
];

function copyDirRecursive(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function externalizeCopiedDemoScripts(outDir) {
  for (const subdir of ["permissions", "editor"]) {
    const htmlPath = path.join(outDir, subdir, "index.html");
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let index = 0;
    let changed = false;
    const rewritten = html.replace(scriptRe, (match, attrs, body) => {
      const trimmed = String(body || "").trim();
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs) || !trimmed) {
        return match;
      }
      index += 1;
      const filename = `${subdir}-demo-${index}.js`;
      fs.writeFileSync(path.join(outDir, subdir, filename), `${trimmed}\n`, "utf8");
      changed = true;
      return `<script src="./${filename}" defer></script>`;
    });
    if (changed) fs.writeFileSync(htmlPath, rewritten, "utf8");
  }
}

function siteProfileIntegration(profile) {
  return {
    name: `portaless-site-profile-${profile.id}`,
    hooks: {
      "astro:config:setup"({ injectRoute }) {
        if (!profile.isDemo) return;
        for (const route of DEMO_ONLY_ROUTES) {
          injectRoute({
            pattern: route.pattern,
            entrypoint: route.entrypoint,
            prerender: true,
          });
        }
      },
      "astro:build:done"({ dir }) {
        const profilePublicDir = path.resolve(process.cwd(), profile.publicDir);
        const outDir = fileURLToPath(dir);
        copyDirRecursive(profilePublicDir, outDir);
        if (profile.isDemo) externalizeCopiedDemoScripts(outDir);
      },
    },
  };
}

// Portaless se compila 100% a sitio estático (output: "static") para poder
// desplegarse en GitHub Pages o Cloudflare Pages sin necesidad de un runtime
// de servidor. Ajusta "site" y "base" según dónde publiques el sitio.
//
// compressHTML: true se fija explícito porque Astro 7 cambió su valor por
// defecto de true a "jsx" -- fijarlo evita que el upgrade de Astro 4 a 7
// (ver package.json) altere silenciosamente el espaciado del HTML generado
// en paginas ya publicadas.
//
// PORTALESS_SITE_PROFILE=starter|demo (default: starter; docs/decisions/starter-and-demo-split.md).
// En starter, las rutas demo-only (/es/*, /beta, /docs, /projections, /shop)
// no se registran en Astro y los assets de site-profiles/demo/public/ no se
// copian a dist/.
export default defineConfig({
  output: "static",
  site: process.env.PORTALESS_SITE_URL || "https://tu-usuario.github.io",
  base: process.env.PORTALESS_BASE_PATH || "/",
  // outDir alterno para builds de verificacion (el sweep de enlaces construye
  // con la base de produccion sin pisar el dist/ que usa Playwright).
  outDir: process.env.PORTALESS_OUT_DIR || "./dist",
  compressHTML: true,
  vite: {
    build: {
      // A-07: nunca inlinear scripts <4 KiB en HTML para cumplir script-src 'self' sin 'unsafe-inline'.
      assetsInlineLimit: 0,
    },
  },
  integrations: [siteProfileIntegration(siteProfile)],
});
