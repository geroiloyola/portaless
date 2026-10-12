// functions/paginas/[slug].js — Phase 0.5 (close the edit->publish cycle).
//
// Sirve /paginas/<slug> DINAMICAMENTE desde la tabla pages cuando la
// pagina existe en la base: el editor la guarda con PUT /admin/pages/
// :slug y el visitante la ve recargando la URL, sin terminal y sin
// rebuild. Antes de esto, /paginas/[slug] solo existia como ruta
// Astro estatica (src/content/pages/*.json en el build) y una pagina
// editada era invisible hasta correr `npm run publish`.
//
// Fallback honesto: si el slug NO esta en la base (o el layout esta
// corrupto), se delega con context.next() al build estatico de dist/
// (igual que Cloudflare Pages cuando no hay Function para el metodo) --
// las paginas de src/content siguen funcionando igual en GitHub Pages,
// donde no hay functions y esta ruta ni existe.
//
// Límites documentados (mismos del ROADMAP Phase 0.5):
//   - self-host y Cloudflare Pages (con DB) cierran el ciclo al
//     instante; GitHub Pages / estatico puro sigue necesitando
//     `npm run publish` para reflejar ediciones;
//   - el shell reutiliza src/styles/global.css leyendolo del disco
//     (self-host siempre tiene el checkout completo; Docker imagen
//     incluye src/). Si no se encuentra, un fallback inline minimo
//     evita la pagina sin estilo;
//   - SEO minimo: title/description/canonical/JSON-LD WebPage basico
//     (el SeoHead/JsonLd completos de Astro quedan para el build).

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory.ts";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema.ts";
import { renderPage } from "../../packages/atomic-elements/src/render.ts";

const GLOBAL_CSS_PATH = fileURLToPath(new URL("../../src/styles/global.css", import.meta.url));

// Fallback critico si src/styles/global.css no esta disponible (deploy
// minimo sin el checkout). Mismas variables oficiales que global.css.
const CSS_FALLBACK = `
:root{--accent:#C5D86D;--accent-text:#5A6B24;--accent-2:#F05D23;--bg:#F7F7F2;--panel-bg:#FFFFFF;--panel-border:#E4E6C3;--text:#261C15;--muted:#6E6653;--portaless-bg:var(--bg);--portaless-fg:var(--text);--portaless-accent:var(--accent);--portaless-muted:var(--muted);--portaless-border:var(--panel-border);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#261C15;--panel-bg:#2F241B;--panel-border:#4A3B2E;--text:#F7F7F2;--muted:#B7AC9B}}
:root[data-theme="dark"]{--bg:#261C15;--panel-bg:#2F241B;--panel-border:#4A3B2E;--text:#F7F7F2;--muted:#B7AC9B}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--accent-text);text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:860px;margin:0 auto;padding:2rem 1.25rem}
header.site-header{border-bottom:1px solid var(--panel-border)}
header.site-header nav{display:flex;gap:1.5rem;align-items:center;max-width:860px;margin:0 auto;padding:1rem 1.25rem}
header.site-header .brand{font-weight:700;font-size:1.1rem;color:var(--text)}
footer.site-footer{border-top:1px solid var(--panel-border);color:var(--muted);font-size:0.85rem}
`.trim();

let cachedGlobalCss = null;

function globalCss() {
  if (cachedGlobalCss !== null) return cachedGlobalCss;
  try {
    cachedGlobalCss = readFileSync(GLOBAL_CSS_PATH, "utf8");
  } catch {
    cachedGlobalCss = CSS_FALLBACK;
  }
  return cachedGlobalCss;
}

const PAGE_CSS = `
.ae-page{display:flex;flex-direction:column;gap:20px;max-width:900px;margin:0 auto}
`.trim();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderShell(layout, bodyHtml, request) {
  const title = esc(layout.title || layout.slug);
  const description = esc(layout.description || "");
  const origin = new URL(request.url).origin;
  const canonical = `${origin}/paginas/${encodeURIComponent(layout.slug)}`;
  const jsonLd = esc(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: layout.title || layout.slug,
    description: layout.description || undefined,
    url: canonical,
  }));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
${description ? `<meta name="description" content="${description}" />` : ""}
<link rel="canonical" href="${esc(canonical)}" />
<link rel="stylesheet" href="/api/site-skin" />
<script>try{var t=localStorage.getItem("portaless-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
<script type="application/ld+json">${jsonLd}</script>
<style>${globalCss()}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="site-header">
  <nav>
    <a class="brand" href="/">Portaless</a>
    <a href="/blog/">Blog</a>
  </nav>
</header>
<main class="container">
<article class="ae-page">${bodyHtml}</article>
</main>
<footer class="site-footer">
  <div class="container">
    Hecho con <a href="https://github.com/" target="_blank">Portaless</a> — open source, licencia MIT.
    Sin hosting pagado. Sin base de datos que administrar.
  </div>
</footer>
</body>
</html>
`;
}

export async function onRequestGet(context) {
  const { params, env, request, next } = context;
  const slug = params?.slug;

  if (!slug || slug.includes("/") || slug.includes("..")) {
    return next();
  }

  let layout = null;
  try {
    const pageStore = await createPageStore(env);
    layout = await pageStore.load(slug);
  } catch {
    // Sin base de datos configurada (deploy estatico puro) o error de
    // lectura: siempre cae al build estatico, nunca 500 en una pagina
    // publica.
    return next();
  }

  if (!layout) return next();

  const validation = validatePageLayout(layout);
  if (!validation.valid) {
    console.error(`[paginas] layout corrupto en la base para "${slug}":`, validation.errors);
    return next();
  }

  let bodyHtml;
  try {
    bodyHtml = await renderPage(layout);
  } catch (err) {
    console.error(`[paginas] error renderizando "${slug}":`, err);
    return next();
  }

  return new Response(renderShell(layout, bodyHtml, request), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
