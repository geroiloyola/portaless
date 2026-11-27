// Atomic Icons Responsive -- el rincon inteligente del header publico.
//
// El header movil trae solo los controles que caben en su inventario de una
// fila. Las acciones contextuales se renderizan junto al contenido de página.
//
//   - root contiene ProductGrid/StoreBlock -> enlace al catálogo del sitio
//   - root contiene Video -> control de volumen que silencia y
//     des-silencia los iframes embebidos de la pagina (YouTube via los
//     comandos postMessage del IFrame API, con enablejsapi=1 en el
//     embed; Vimeo via su protocolo method/value, best-effort)
//   - Map -> Cómo llegar
//
// La decision recorre el arbol de elementos en PREORDEN: el primer nodo
// que defina contexto gana (una pagina con Video arriba y productos
// abajo es, para el rincon, una pagina de video). Es un modulo puro de
// src/lib para que lo compartan el header Astro (Header.astro vía
// BaseLayout) y el shell runtime de functions/paginas/[slug].js SIN
// duplicar la logica -- la clase de bug que ya hizo decir "MIT" al
// footer runtime mientras el build decia AGPL.
//
// Rutas: la UNICA fuente es src/lib/routes.ts -- nunca segmentos a mano.
import { ROUTES } from "./routes";
import {
  ICON_DIRECTIONS,
  ICON_LANGUAGES,
  ICON_NEWSPAPER,
  ICON_SEARCH,
  ICON_SHARE_IOS,
  ICON_SHOPPING_CART,
  ICON_STORE,
  ICON_VOLUME_2,
} from "@portaless/visual-elements/icons";

export type HeaderContext = "shop" | "video" | "map" | null;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

// Forma minima del nodo del arbol de PageLayout.root: solo se leen
// type/children (las props no participan en la decision).
interface ContextNode {
  type?: string;
  children?: ContextNode[];
}

export function deriveHeaderContext(root: readonly unknown[] | undefined | null): HeaderContext {
  return firstContext(Array.isArray(root) ? root : []);
}

function firstContext(nodes: readonly unknown[]): HeaderContext {
  for (const raw of nodes) {
    const node = raw as ContextNode | null | undefined;
    if (!node || typeof node !== "object") continue;
    if (node.type === "Video") return "video";
    if (node.type === "Map") return "map";
    if (node.type === "ProductGrid" || node.type === "StoreBlock") return "shop";
    if (Array.isArray(node.children)) {
      const inner = firstContext(node.children);
      if (inner) return inner;
    }
  }
  return null;
}

export function contextActionsHtml(context: HeaderContext, base = "/"): string {
  const cart =
    context === "shop"
      ? `<a class="page-context-action" href="${escapeHtml(base)}${ROUTES.SHOP.replace(/^\//, "")}/" aria-label="Ir a la tienda">${ICON_SHOPPING_CART}<span>Ir a la tienda</span></a>`
      : "";
  const volume =
    context === "video"
      ? `<button type="button" class="page-context-action" data-portaless-volume aria-pressed="false" aria-label="Silenciar video">${ICON_VOLUME_2}<span>Silenciar video</span></button>`
      : "";
  const directions =
    context === "map"
      ? `<a class="page-context-action" href="#ae-map" aria-label="Cómo llegar">${ICON_DIRECTIONS}<span>Cómo llegar</span></a>`
      : "";
  const actions = `${cart}${volume}${directions}`;
  return actions ? `<nav class="page-context-actions" aria-label="Acciones de esta página">${actions}</nav>` : "";
}

export function headerShareHtml(): string {
  // Share: SIEMPRE, con el icono iOS (caja + flecha). El listener
  // delegado que lo atiende vive en BaseLayout (build) y en el shell
  // runtime -- ninguno de los dos se toca aqui.
  return `<button type="button" class="header-icon-btn" data-portaless-share aria-label="Compartir este enlace" title="Compartir este enlace">${ICON_SHARE_IOS}</button>`;
}

/**
 * Accion contextual circular (44x44) en el header para escritorio cuando el
 * contenido de la pagina lo dispara (ProductGrid/StoreBlock -> Cart,
 * Map -> Navigate, Video -> Volume). En movil <=640px se oculta por CSS y
 * prevalece contextActionsHtml() junto al contenido para cuidar el ancho 320px.
 */
export function headerContextActionHtml(context: HeaderContext, base = "/"): string {
  if (context === "shop") {
    return `<a class="header-icon-btn header-context-action" href="${escapeHtml(base)}${ROUTES.SHOP.replace(/^\//, "")}/" aria-label="Ir a la tienda" title="Ir a la tienda">${ICON_SHOPPING_CART}</a>`;
  }
  if (context === "map") {
    return `<a class="header-icon-btn header-context-action" href="#ae-map" aria-label="Cómo llegar" title="Cómo llegar">${ICON_DIRECTIONS}</a>`;
  }
  if (context === "video") {
    return `<button type="button" class="header-icon-btn header-context-action" data-portaless-volume aria-pressed="false" aria-label="Silenciar video" title="Silenciar video">${ICON_VOLUME_2}</button>`;
  }
  return "";
}

/**
 * Boton circular 44x44 de alternancia Claro/Oscuro (CSP estricto: el clic
 * se atiende en public/portaless-shell.js y el icono activo lo decide CSS).
 */
export function headerThemeToggleHtml(locale: string = "es"): string {
  const label = locale === "es" ? "Cambiar modo claro/oscuro" : "Toggle light/dark mode";
  return `<button type="button" class="header-icon-btn header-theme-toggle" data-theme-toggle aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="false">`
    + `<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
    + `<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`
    + `</button>`;
}

/** Header-action compatibility helper; context controls are not placed here. */
export function headerActionsHtml(_context: HeaderContext, _base = "/"): string {
  return `<div class="header-actions">${headerShareHtml()}</div>`;
}

// Selector de idioma del header: vive en el grupo derecho (junto a los
// iconos) y lleva un icono de "idiomas" para que se lea como una accion
// (cambiar de idioma), no como otra entrada del menu. UNA sola fuente para
// el header Astro y el shell runtime; el texto/href/aria los resuelve cada
// superficie con su locale (t(...) en el build, SITE_LANG en el runtime).
export function langSwitcherHtml(input: {
  href: string;
  hreflang: string;
  ariaLabel: string;
  text: string;
  compact?: boolean;
}): string {
  const href = escapeHtml(input.href);
  const hreflang = escapeHtml(input.hreflang);
  const ariaLabel = escapeHtml(input.ariaLabel);
  const cls = input.compact ? "header-lang header-lang--circle" : "header-lang";
  return `<a class="${cls}" href="${href}" hreflang="${hreflang}" aria-label="${ariaLabel}" title="${ariaLabel}"><span class="header-lang-icon" aria-hidden="true">${ICON_LANGUAGES}</span><span class="header-lang-text">${escapeHtml(input.text)}</span></a>`;
}

// Aviso de idioma (patron Airbnb: "Some info is shown in its original
// language"), pero HONESTO con lo que el sitio puede hacer hoy: no hay
// traduccion automatica (es GATED: requiere provider + procedencia), asi que en
// una pagina sin version en el otro idioma NO se promete traducir NI se enlaza a
// otro sitio -- solo se declara que la pagina esta en un solo idioma. Si algun
// dia hay un CTA (p.ej. traduccion automatica con proveedor), se pasa
// ctaLabel+href. Aparece solo si el sitio es multi-locale. UNA fuente para el
// header Astro y el shell runtime.
export function langNoticeHtml(input: { text: string; ctaLabel?: string; href?: string }): string {
  const cta =
    input.ctaLabel && input.href
      ? ` <a class="header-lang-notice-link" href="${escapeHtml(input.href)}">${escapeHtml(input.ctaLabel)}</a>`
      : "";
  return `<p class="header-lang-notice"><span class="header-lang-notice-txt">${escapeHtml(input.text)}</span>${cta}</p>`;
}

// Iconos de navegacion para MOVIL (CSS los muestra solo bajo el breakpoint; en
// desktop se ve el texto). UNA sola fuente para el header Astro y el shell
// runtime, igual que headerActionsHtml/langSwitcherHtml -- asi no driftan. El
// texto de cada enlace SIGUE en el DOM (clase .nav-txt, oculto visualmente en
// movil) para no perder el nombre accesible.
export const NAV_ICONS = {
  posts: ICON_NEWSPAPER,
  explore: ICON_SEARCH,
  shop: ICON_STORE,
} as const;

export function navIconHtml(icon: string): string {
  return `<span class="nav-ico" aria-hidden="true">${icon}</span>`;
}

// Listener delegado del control de volumen (Atomic Icons Responsive),
// embebido igual que SHARE_LISTENER_SCRIPT: sin handlers inline en el
// HTML, compatible con una CSP futura. PostMessage crudo, sin SDK de
// YouTube ni de Vimeo: si un player no responde al comando, no pasa nada
// (estado local documentado en el design guide; ver limites).
export const VOLUME_LISTENER_SCRIPT = `document.addEventListener("click", function (e) {
  var t = e.target;
  var btn = t && t.closest ? t.closest("[data-portaless-volume]") : null;
  if (!btn) return;
  var muted = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", muted ? "true" : "false");
  btn.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar video");
  btn.setAttribute("title", muted ? "Activar sonido" : "Silenciar video");
  var frames = document.querySelectorAll(".ae-video iframe");
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var src = frame.getAttribute("src") || "";
    var payload = null;
    if (src.indexOf("youtube") !== -1 || src.indexOf("youtu.be") !== -1) {
      payload = JSON.stringify({ event: "command", func: muted ? "mute" : "unmute", args: "" });
    } else if (src.indexOf("player.vimeo.com") !== -1) {
      payload = JSON.stringify({ method: "setVolume", value: muted ? 0 : 1 });
    }
    if (!payload) continue;
    try { frame.contentWindow.postMessage(payload, "*"); } catch (err) { /* cross-origin duro: nada */ }
  }
});`;
