// Atomic Icons Responsive -- el rincon inteligente del header publico.
//
// El header SIEMPRE trae Share (mismo listener delegado
// [data-portaless-share] de BaseLayout: Web Share API o copiar la URL con
// toast). Ademas, el icono PRINCIPAL del rincon se deriva del contenido
// de la pagina que el visitante esta viendo -- sin configuracion manual:
//
//   - root contiene ProductGrid/StoreBlock -> carrito, que lleva a
//     /tienda/ (la pagina de tienda del sitio; existe siempre)
//   - root contiene Video -> control de volumen que silencia y
//     des-silencia los iframes embebidos de la pagina (YouTube via los
//     comandos postMessage del IFrame API, con enablejsapi=1 en el
//     embed; Vimeo via su protocolo method/value, best-effort)
//   - cualquier otra pagina (bio, servicios, portafolio...) -> solo Share
//
// La decision recorre el arbol de elementos en PREORDEN: el primer nodo
// que defina contexto gana (una pagina con Video arriba y productos
// abajo es, para el rincon, una pagina de video). Es un modulo puro de
// src/lib para que lo compartan el header Astro (Header.astro vía
// BaseLayout) y el shell runtime de functions/paginas/[slug].js SIN
// duplicar la logica -- la clase de bug que ya hizo decir "MIT" al
// footer runtime mientras el build decia AGPL.
import {
  ICON_DIRECTIONS,
  ICON_LANGUAGES,
  ICON_SHARE_IOS,
  ICON_SHOPPING_CART,
  ICON_VOLUME_2,
} from "../../packages/atomic-elements/src/elements/icons";

export type HeaderContext = "shop" | "video" | "map" | null;

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

// HTML del rincon derecho del header. UNA sola fuente para ambas
// superficies (Astro y runtime): los tests aun asi fijan la paridad por
// fuente, por si algun dia alguien deja de pasar por aqui.
// `base` es el prefijo de rutas (import.meta.env.BASE_URL en el build,
// "/" en el runtime).
export function headerActionsHtml(context: HeaderContext, base = "/"): string {
  const cart =
    context === "shop"
      ? `<a class="header-icon-btn" href="${base}tienda/" aria-label="Ir a la tienda" title="Tienda">${ICON_SHOPPING_CART}</a>`
      : "";
  const volume =
    context === "video"
      ? `<button type="button" class="header-icon-btn" data-portaless-volume aria-pressed="false" aria-label="Silenciar video" title="Silenciar video">${ICON_VOLUME_2}</button>`
      : "";
  const directions =
    context === "map"
      ? `<a class="header-icon-btn" href="#ae-map" aria-label="Cómo llegar" title="Cómo llegar">${ICON_DIRECTIONS}</a>`
      : "";
  // Share: SIEMPRE, con el icono iOS (caja + flecha). El listener
  // delegado que lo atiende vive en BaseLayout (build) y en el shell
  // runtime -- ninguno de los dos se toca aqui.
  const share = `<button type="button" class="header-icon-btn" data-portaless-share aria-label="Compartir este enlace" title="Compartir este enlace">${ICON_SHARE_IOS}</button>`;
  return `<div class="header-actions">${cart}${volume}${directions}${share}</div>`;
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
}): string {
  return `<a class="header-lang" href="${input.href}" hreflang="${input.hreflang}" aria-label="${input.ariaLabel}" title="${input.ariaLabel}"><span class="header-lang-icon" aria-hidden="true">${ICON_LANGUAGES}</span><span class="header-lang-text">${input.text}</span></a>`;
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
