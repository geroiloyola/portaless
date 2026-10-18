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
import fs from "node:fs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory.ts";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema.ts";
import { renderPage } from "../../packages/atomic-elements/src/render.ts";
import { SITE_LANG, postsLabel, homeLabel, exploreLabel } from "../../src/lib/site-lang.ts";
import { isMultilingual, t } from "../../src/lib/i18n.ts";
import {
  deriveHeaderContext,
  headerActionsHtml,
  langNoticeHtml,
  NAV_ICONS,
  navIconHtml,
  trustLinkHtml,
  VOLUME_LISTENER_SCRIPT,
} from "../../src/lib/atomic-responsive-icons.ts";
import {
  BUILTIN_THEMES,
  resolveThemePack,
  themeStyleDecl,
} from "../../packages/atomic-elements/src/themes/theme-pack.ts";

const GLOBAL_CSS_PATH = fileURLToPath(new URL("../../src/styles/global.css", import.meta.url));
const ELEMENTS_CSS_PATH = fileURLToPath(
  new URL("../../packages/atomic-elements/src/styles/elements.css", import.meta.url)
);

// Paridad con el build estatico (BaseLayout/Header/Footer de Astro): el
// header solo anuncia las publicaciones si el sitio tiene alguna, y la
// palabra sale de src/lib/site-lang.ts (Publicaciones | Posts), nunca
// "Blog". El runtime no tiene el conteo de build a mano, asi que mira
// src/content/posts en disco -- mismo patron defensivo que globalCss():
// si el filesystem no esta disponible (CF Pages sin checkout) se MUESTRA
// el link, porque un indice vacio es un fallo suave y ocultar la
// navegacion de un sitio que si publica no lo es. Los drafts no se
// evaluan aqui: con solo borradores el link cae a un indice con su
// empty state (el indice si los filtra).
let postsLinkShown = null;
function showPostsLink() {
  if (postsLinkShown !== null) return postsLinkShown;
  try {
    const dir = fileURLToPath(new URL("../../src/content/posts", import.meta.url));
    postsLinkShown = fs
      .readdirSync(dir)
      .some((name) => /\.(md|mdx)$/.test(name) && !name.startsWith("_"));
  } catch {
    postsLinkShown = true;
  }
  return postsLinkShown;
}

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
header.site-header .header-actions{display:flex;align-items:center;gap:0.3rem;margin-left:auto}
header.site-header .header-right{display:flex;align-items:center;gap:0.6rem;margin-left:auto}
header.site-header .header-lang{display:inline-flex;align-items:center;gap:0.4rem;padding:0.32rem 0.7rem;border:1px solid var(--panel-border);border-radius:999px;color:var(--text);font-size:0.85rem;line-height:1;text-decoration:none}
header.site-header .header-lang:hover{border-color:var(--accent);color:var(--accent)}
header.site-header .header-lang-icon svg{width:16px;height:16px}
header.site-header .header-lang-notice{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.4rem;max-width:860px;margin:0 auto;padding:0 1.25rem 0.7rem;font-size:0.8rem;line-height:1.4;color:var(--muted)}
header.site-header .header-lang-notice-link{color:var(--accent-text);white-space:nowrap}
header.site-header .header-trust{display:inline-flex;align-items:center;gap:0.4rem;padding:0.32rem 0.7rem;border:1px solid var(--panel-border);border-radius:999px;color:var(--text);font-size:0.85rem;line-height:1;text-decoration:none}
header.site-header .header-trust:hover{border-color:var(--accent);color:var(--accent)}
header.site-header .header-trust-icon svg{width:16px;height:16px}
header.site-header .nav-ico{display:none;align-items:center;justify-content:center}
@media (max-width:640px){header.site-header nav{gap:0.3rem;padding:0.75rem 0.9rem}header.site-header .brand{font-size:1rem}header.site-header .nav-link{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;color:var(--text)}header.site-header .nav-link:hover{color:var(--accent)}header.site-header .nav-link .nav-ico{display:inline-flex}header.site-header .nav-link .nav-ico svg{width:19px;height:19px}header.site-header .nav-link .nav-txt{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}header.site-header .header-right{gap:0.3rem}header.site-header .header-lang{width:34px;height:34px;padding:0;justify-content:center}header.site-header .header-lang .header-lang-text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}header.site-header .header-trust{width:34px;height:34px;padding:0;justify-content:center}header.site-header .header-trust .header-trust-text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}}
header.site-header .header-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--panel-border);border-radius:999px;background:transparent;color:var(--text);cursor:pointer}
header.site-header .header-icon-btn:hover{border-color:var(--accent);color:var(--accent)}
header.site-header .header-icon-btn svg{width:18px;height:18px}
header.site-header .header-icon-btn[aria-pressed="true"]{opacity:0.55}
footer.site-footer{border-top:1px solid var(--panel-border);color:var(--muted);font-size:0.85rem}
footer.site-footer .footer-eco{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;font-weight:600}
footer.site-footer .footer-eco a{color:var(--text)}
footer.site-footer .footer-eco .sep{color:var(--muted)}
footer.site-footer .footer-note{margin:0.35rem 0 0}
`.trim();

let cachedGlobalCss = null;

function globalCss() {
  if (cachedGlobalCss !== null) return cachedGlobalCss;
  try {
    cachedGlobalCss = fs.readFileSync(GLOBAL_CSS_PATH, "utf8");
  } catch {
    cachedGlobalCss = CSS_FALLBACK;
  }
  return cachedGlobalCss;
}

// Layout de las grillas del core (intrinseco). Mismo archivo que importa
// BaseLayout en el build; el shell lo lee del disco (paridad build <-> runtime).
let cachedElementsCss = null;

function elementsCss() {
  if (cachedElementsCss !== null) return cachedElementsCss;
  try {
    cachedElementsCss = fs.readFileSync(ELEMENTS_CSS_PATH, "utf8");
  } catch {
    cachedElementsCss = "";
  }
  return cachedElementsCss;
}

const PAGE_CSS = `
.ae-page{display:flex;flex-direction:column;gap:20px;max-width:900px;margin:0 auto}
`.trim();

// Boton "Compartir" de las paginas bio (ProfileHeader) -- MISMO cuerpo
// que el <script is:inline> de src/layouts/BaseLayout.astro (la pagina
// servida desde la base tiene que comportarse igual que la estatica);
// el contrato lo fija tests/unit/profile-header-share.test.ts. Sin
// handlers inline, compatible con una CSP futura.
const SHARE_LISTENER_SCRIPT = `
document.addEventListener("click", async function (e) {
  var t = e.target;
  var el = t && t.closest ? t.closest("[data-portaless-share]") : null;
  if (!el) return;
  e.preventDefault();
  var url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url: url }); return; }
    catch (err) { if (err && err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    var toast = document.createElement("div");
    toast.textContent = "Enlace copiado";
    toast.setAttribute("role", "status");
    toast.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#261C15;color:#fff;padding:8px 16px;border-radius:999px;font-size:0.85rem;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.25);";
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 1800);
  } catch (err) { /* sin clipboard (contexto no seguro): nada que romper */ }
});
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
  const canonical = `${origin}/pages/${encodeURIComponent(layout.slug)}`;
  // Tema por pagina (paridad con BaseLayout.astro). Solo los builtins: la
  // pagina servida desde la base tampoco consulta la tabla theme_packs
  // aqui (el catalogo efectivo se arma en el MCP); un nombre que no
  // resuelve deja la pagina con el skin del sitio. Las variables van como
  // atributo style en <html> -- misma decision y motivo que el layout
  // estatico: un inline gana a cualquier regla de hoja, sin depender del
  // orden en que este shell cargue global.css (el @media oscuro tiene
  // misma especificidad y vendria despues).
  const pageTheme = layout.theme ? resolveThemePack(BUILTIN_THEMES, layout.theme) : null;
  const themeCss = pageTheme ? themeStyleDecl(pageTheme) : "";
  const themeAttr = pageTheme ? ` data-theme-pack="${esc(pageTheme.name)}"` : "";
  const themeStyleAttr = themeCss ? ` style="${esc(themeCss)}"` : "";
  const jsonLd = esc(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: layout.title || layout.slug,
    description: layout.description || undefined,
    url: canonical,
  }));
  return `<!doctype html>
<html lang="${SITE_LANG}"${themeAttr}${themeStyleAttr}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
${description ? `<meta name="description" content="${description}" />` : ""}
<link rel="canonical" href="${esc(canonical)}" />
<link rel="stylesheet" href="/api/site-skin" />
<script>try{var t=localStorage.getItem("portaless-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
<script>${SHARE_LISTENER_SCRIPT}</script>
<script>${VOLUME_LISTENER_SCRIPT}</script>
<script type="application/ld+json">${jsonLd}</script>
<style>${globalCss()}
${elementsCss()}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="site-header">
  <nav>
    <a class="brand" href="/">Portaless</a>
    <a class="nav-link" href="/">${navIconHtml(NAV_ICONS.home)}<span class="nav-txt">${homeLabel(SITE_LANG)}</span></a>
    ${showPostsLink() ? `<a class="nav-link" href="/blog/">${navIconHtml(NAV_ICONS.posts)}<span class="nav-txt">${postsLabel(SITE_LANG)}</span></a>` : ""}
    <a class="nav-link" href="/explore/">${navIconHtml(NAV_ICONS.explore)}<span class="nav-txt">${exploreLabel(SITE_LANG)}</span></a>
    <div class="header-right">
      ${trustLinkHtml({ href: "/trust/", label: t(SITE_LANG, "trust.label"), ariaLabel: t(SITE_LANG, "trust.aria") })}
      ${headerActionsHtml(deriveHeaderContext(layout.root))}
    </div>
  </nav>
  ${
    isMultilingual()
      ? langNoticeHtml({ text: t(SITE_LANG, "lang.notice") })
      : ""
  }
</header>
<main class="container">
<article class="ae-page">${bodyHtml}</article>
</main>
<footer class="site-footer">
  <div class="container">
    <nav class="footer-eco" aria-label="${t(SITE_LANG, "footer.ecoAria")}">
      <a href="/trust/">${t(SITE_LANG, "footer.trust")}</a>
      <span class="sep" aria-hidden="true">·</span>
      <a href="/explore/">${t(SITE_LANG, "footer.explore")}</a>
      <span class="sep" aria-hidden="true">·</span>
      <a href="https://github.com/geroiloyola/portaless" target="_blank" rel="noopener noreferrer">${t(SITE_LANG, "footer.poweredBy")}</a>
    </nav>
    <p class="footer-note">
      ${t(SITE_LANG, "footer.promise")}
    </p>
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
