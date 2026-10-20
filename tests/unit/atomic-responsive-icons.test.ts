// Atomic Icons Responsive -- el rincon inteligente del header publico.
// Cuatro contratos:
//   1. La derivacion de contexto es pura, predecible y en PREORDEN: el
//      primer elemento del arbol que defina contexto decide.
//   2. El HTML del rincon sale de UNA sola fuente (headerActionsHtml),
//      compartida por el header Astro y el shell runtime.
//   3. El share del rincon y el del ProfileHeader usan el icono iOS
//      (caja + flecha), nunca la variante share-2 del palette.
//   4. El control de volumen habla con los players via postMessage y
//      ambos emisores (BaseLayout y shell) traen el listener delegado.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveHeaderContext,
  headerActionsHtml,
  langNoticeHtml,
  langSwitcherHtml,
  NAV_ICONS,
  navIconHtml,
  trustLinkHtml,
} from "../../src/lib/atomic-responsive-icons";
import {
  ICON_DIRECTIONS,
  ICON_HOUSE,
  ICON_LANGUAGES,
  ICON_NEWSPAPER,
  ICON_SEARCH,
  ICON_SHARE_IOS,
  ICON_SHIELD,
  ICON_SHOPPING_CART,
  ICON_STORE,
  ICON_VOLUME_2,
} from "../../packages/atomic-elements/src/elements/icons";
import { elementRegistry } from "../../packages/atomic-elements/src/elements/registry";
import { renderPublicHeaderHtml } from "../../src/lib/public-shell";

const root = join(__dirname, "../..");
const headerSrc = readFileSync(join(root, "src/components/Header.astro"), "utf8");
const publicShellSrc = readFileSync(join(root, "src/lib/public-shell.ts"), "utf8");
const baseLayoutSrc = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");
// La logica de la pagina de contenido vive en el componente compartido
// (lo usan la ruta primaria y la de traduccion).
const slugPageSrc = readFileSync(join(root, "src/components/ContentPage.astro"), "utf8");
const shellSrc = readFileSync(join(root, "functions/pages/[slug].js"), "utf8");

describe("deriveHeaderContext -- derivacion del icono principal", () => {
  it("sin contexto (bio, servicios, portafolio...) devuelve null", () => {
    expect(deriveHeaderContext([])).toBeNull();
    expect(deriveHeaderContext(undefined)).toBeNull();
    expect(deriveHeaderContext(null)).toBeNull();
    expect(deriveHeaderContext([{ type: "ProfileHeader" }, { type: "LinkList" }])).toBeNull();
  });

  it("ProductGrid y StoreBlock son shop; Video es video; Map es map", () => {
    expect(deriveHeaderContext([{ type: "ProductGrid" }])).toBe("shop");
    expect(deriveHeaderContext([{ type: "StoreBlock" }])).toBe("shop");
    expect(deriveHeaderContext([{ type: "Video" }])).toBe("video");
    expect(deriveHeaderContext([{ type: "Map" }])).toBe("map");
  });

  it("recorre los hijos anidados (un Video dentro de Columns cuenta)", () => {
    const rootTree = [
      { type: "Hero" },
      {
        type: "Columns",
        children: [{ type: "Columns", children: [{ type: "Video" }] }],
      },
    ];
    expect(deriveHeaderContext(rootTree)).toBe("video");
  });

  it("preorden: el PRIMERO que defina contexto gana (Video arriba, productos abajo = video)", () => {
    expect(deriveHeaderContext([{ type: "Video" }, { type: "ProductGrid" }])).toBe("video");
    expect(deriveHeaderContext([{ type: "StoreBlock" }, { type: "Video" }])).toBe("shop");
  });

  it("nodos corruptos no rompen la derivacion", () => {
    expect(deriveHeaderContext([null, undefined, "x", 42, { type: "Video" }])).toBe("video");
  });
});

describe("headerActionsHtml -- una sola fuente para ambas superficies", () => {
  it("contexto null: solo el boton compartir, con el icono iOS", () => {
    const html = headerActionsHtml(null);
    expect(html).toContain("data-portaless-share");
    expect(html).toContain('aria-label="Compartir este enlace"');
    expect(html).toContain(ICON_SHARE_IOS);
    expect(html).not.toContain("data-portaless-volume");
    expect(html).not.toContain("/shop/");
    expect(html).not.toContain('cx="18" cy="5"');
  });

  it("shop: carrito primero (a /shop/) y share al lado", () => {
    const html = headerActionsHtml("shop");
    expect(html).toContain('href="/shop/"');
    expect(html).toContain('aria-label="Ir a la tienda"');
    expect(html).toContain(ICON_SHOPPING_CART);
    expect(html).toContain("data-portaless-share");
    // el carrito va ANTES del share en el rincon
    expect(html.indexOf("tienda/")).toBeLessThan(html.indexOf("data-portaless-share"));
  });

  it("video: control de volumen (aria-pressed arranca en false) y share", () => {
    const html = headerActionsHtml("video");
    expect(html).toContain("data-portaless-volume");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Silenciar video"');
    expect(html).toContain(ICON_VOLUME_2);
    expect(html).toContain("data-portaless-share");
    expect(html.indexOf("data-portaless-volume")).toBeLessThan(html.indexOf("data-portaless-share"));
  });

  it("map: icono de como llegar (anclado a #ae-map con ICON_DIRECTIONS) y share", () => {
    const html = headerActionsHtml("map");
    expect(html).toContain('href="#ae-map"');
    expect(html).toContain('aria-label="Cómo llegar"');
    expect(html).toContain(ICON_DIRECTIONS);
    expect(html).toContain("data-portaless-share");
    expect(html.indexOf("#ae-map")).toBeLessThan(html.indexOf("data-portaless-share"));
  });

  it("respeta el prefijo base de rutas (import.meta.env.BASE_URL)", () => {
    expect(headerActionsHtml("shop", "/sub/")).toContain('href="/sub/shop/"');
  });
});

describe("langSwitcherHtml -- el selector de idioma como accion", () => {
  it("es un enlace con clase header-lang, hreflang y aria-label", () => {
    const html = langSwitcherHtml({
      href: "/es/",
      hreflang: "es",
      ariaLabel: "Read this page in Spanish",
      text: "Español",
    });
    expect(html).toContain('class="header-lang"');
    expect(html).toContain('href="/es/"');
    expect(html).toContain('hreflang="es"');
    expect(html).toContain('aria-label="Read this page in Spanish"');
    expect(html).toContain('title="Read this page in Spanish"');
    expect(html).toContain("Español");
  });

  it("trae el icono de idiomas para que se lea como un control", () => {
    const html = langSwitcherHtml({ href: "/es/", hreflang: "es", ariaLabel: "x", text: "Español" });
    expect(html).toContain(ICON_LANGUAGES);
    expect(html).toContain('class="header-lang-icon"');
    // el icono es decorativo: el nombre accesible lo da el aria-label
    expect(html).toContain('aria-hidden="true"');
  });

  it("el idioma vive en el grupo DERECHO junto a los iconos, no entre las etiquetas", () => {
    expect(headerSrc).toContain("renderPublicHeaderHtml({");
    const html = renderPublicHeaderHtml({
      base: "/base/",
      locale: "es",
      hasPosts: true,
      commerceEnabled: false,
      context: null,
      languageAlternate: { hreflang: "en", href: "/base/en/" },
    });
    expect(html).toContain('<nav class="site-nav"');
    const navEnd = html.indexOf("</nav>");
    const actionsStart = html.indexOf('<div class="header-right"');
    expect(actionsStart).toBeGreaterThan(navEnd);
    expect(html.indexOf('class="header-lang"')).toBeGreaterThan(actionsStart);
    expect(html.indexOf('class="header-actions"')).toBeGreaterThan(actionsStart);
  });

  it("el shell runtime emite el AVISO de idioma con la MISMA fuente", () => {
    // El shell sirve /pages/*, que no estan localizadas: no lleva el switcher
    // sino el aviso honesto.
    expect(shellSrc).toContain("renderPublicHeaderHtml({");
    expect(shellSrc).toContain("hasPosts: showPostsLink()");
    expect(shellSrc).toContain("deriveHeaderContext(layout.root)");
    expect(renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: false, commerceEnabled: false })).toContain("header-lang-notice");
  });

  it("el CSS alinea el grupo derecho (margin-left:auto) y pinta el pill", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain(".header-right");
    expect(cssSrc).toContain(".header-lang");
    expect(cssSrc).toContain(".header-lang-icon");
    expect(shellSrc).toContain(".header-right{");
    expect(shellSrc).toContain(".header-lang{");
  });
});

describe("langNoticeHtml -- aviso de idioma honesto (patron Airbnb)", () => {
  it("es una linea con texto y un enlace a la version del otro idioma", () => {
    const html = langNoticeHtml({
      text: "This page is only available in one language.",
      ctaLabel: "See the site in Spanish",
      href: "/es/",
    });
    expect(html).toContain('class="header-lang-notice"');
    expect(html).toContain('class="header-lang-notice-txt"');
    expect(html).toContain("only available in one language");
    expect(html).toContain('class="header-lang-notice-link" href="/es/"');
    expect(html).toContain("See the site in Spanish");
  });

  it("NO promete traducir: el aviso no dice 'Translate'", () => {
    const html = langNoticeHtml({ text: "x", ctaLabel: "y", href: "/es/" });
    expect(html.toLowerCase()).not.toContain("translate");
  });

  it("el header dibuja el switcher SOLO con alternatePath, y el aviso sin el", () => {
    // El contrato vive en el renderer compartido; alternatePath es el dato real.
    expect(publicShellSrc).toContain("const localized = Boolean(languageAlternate) || Boolean(alternatePath)");
    expect(publicShellSrc).toContain("const showSwitcher = isMultilingual() && localized");
    expect(publicShellSrc).toContain("const showNotice = isMultilingual() && !localized");
    expect(publicShellSrc).toContain("langNoticeHtml({ text: t(locale, \"lang.notice\") })");
    expect(renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: false, commerceEnabled: false }))
      .toContain('class="header-lang-notice"');
    expect(renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: false, commerceEnabled: false, alternatePath: "/" }))
      .toContain('class="header-lang"');
  });

  it("el CSS del aviso esta en ambas superficies", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain(".header-lang-notice");
    expect(shellSrc).toContain(".header-lang-notice{");
  });
});

describe("trustLinkHtml -- TrustScore en el header (sexto item universal)", () => {
  it("es un enlace con clase header-trust, el icono escudo y la etiqueta", () => {
    const html = trustLinkHtml({ href: "/trust/", label: "TrustScore", ariaLabel: "Site Trust Score" });
    expect(html).toContain('class="header-trust"');
    expect(html).toContain('href="/trust/"');
    expect(html).toContain('aria-label="Site Trust Score"');
    expect(html).toContain(ICON_SHIELD);
    expect(html).toContain('class="header-trust-icon"');
    expect(html).toContain("TrustScore");
  });

  it("el header Astro y el shell runtime lo emiten desde la MISMA fuente", () => {
    expect(headerSrc).toContain("renderPublicHeaderHtml({");
    expect(shellSrc).toContain("renderPublicHeaderHtml({");
    expect(publicShellSrc).toContain("trustLinkHtml({");
  });

  it("va en el grupo derecho, antes de las acciones (share)", () => {
    const html = renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: false, commerceEnabled: false });
    const groupIdx = html.indexOf('class="header-right"');
    const trustIdx = html.indexOf('class="header-trust"');
    const actionsIdx = html.indexOf('class="header-actions"');
    expect(trustIdx).toBeGreaterThan(groupIdx);
    expect(actionsIdx).toBeGreaterThan(trustIdx);
  });

  it("el CSS del header-trust esta en ambas superficies (y en movil icon-only)", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain(".header-trust");
    expect(cssSrc).toContain(".header-trust-icon");
    expect(shellSrc).toContain(".header-trust{");
    expect(shellSrc).toContain(".header-trust .header-trust-text{");
  });
});

describe("nav movil por iconos -- una sola fuente", () => {
  it("la marca es el destino Inicio y NAV_ICONS solo cubre otros destinos", () => {
    expect(NAV_ICONS.posts).toBe(ICON_NEWSPAPER);
    expect(NAV_ICONS.explore).toBe(ICON_SEARCH);
    expect(NAV_ICONS.shop).toBe(ICON_STORE);
    expect(NAV_ICONS).not.toHaveProperty("home");
  });

  it("navIconHtml es un span decorativo (.nav-ico, aria-hidden)", () => {
    const html = navIconHtml(ICON_HOUSE);
    expect(html).toContain('class="nav-ico"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(ICON_HOUSE);
  });

  it("Header.astro y el shell usan el contrato compartido de marca, nav y acciones", () => {
    expect(headerSrc).toContain("renderPublicHeaderHtml({");
    expect(headerSrc).toContain("hasPosts: publicPosts.length > 0");
    expect(shellSrc).toContain("renderPublicHeaderHtml({");
    const html = renderPublicHeaderHtml({ base: "/", locale: "en", hasPosts: true, commerceEnabled: false });
    expect(html).toContain('<a class="brand nav-home" href="/" aria-label="Home — Portaless">Portaless</a>');
    expect(html).toContain('class="nav-ico"');
    expect(html).toContain('<span class="nav-txt">Publications</span>');
    expect(html).toContain('<span class="nav-txt">Explore</span>');
    expect(html.match(/class="brand nav-home"/g)).toHaveLength(1);
    expect(html).not.toContain('class="nav-link" href="/"');
  });

  it("el modo iconos es SOLO movil (media query en ambos CSS, desktop con texto)", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain(".nav-ico");
    expect(cssSrc).toContain(".nav-txt");
    expect(cssSrc).toContain("@media (max-width: 640px)");
    // en desktop el icono esta oculto (display:none por defecto)
    expect(cssSrc).toMatch(/\.nav-ico\s*\{[^}]*display:\s*none/);
    expect(shellSrc).toContain("@media (max-width:640px)");
    expect(shellSrc).toContain(".nav-ico{display:none");
    expect(shellSrc).toContain(".nav-txt{");
  });

  it("el compartir NO se toca en movil: sigue siendo .header-icon-btn redondo", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain("header.site-header .header-icon-btn");
    // El bloque movil no menciona el share: no se re-estiliza ni se mueve.
    const mobile = cssSrc.slice(
      cssSrc.indexOf("@media (max-width: 640px)"),
      cssSrc.indexOf("header.site-header .header-icon-btn", cssSrc.indexOf("@media (max-width: 640px)")),
    );
    expect(mobile).not.toContain("header-icon-btn");
  });

  it("mantiene una fila nav y separa las acciones del sitio en viewport móvil", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toMatch(/nav\.site-nav\s*\{[^}]*flex-wrap:\s*nowrap/);
    const mobile = cssSrc.slice(cssSrc.indexOf("@media (max-width: 640px)"));
    expect(mobile).toContain(".site-header-row");
    expect(mobile).toContain("flex-direction: column");
    expect(mobile).toContain(".header-right");
    expect(mobile).toContain("width: 100%");
    expect(shellSrc).toContain("nav.site-nav{display:flex;align-items:center;gap:1.5rem;flex:1 1 auto;min-width:0;flex-wrap:nowrap}");
  });
});

describe("rincon del header -- wiring estatico y runtime", () => {
  it("Header.astro usa la fuente unica y expone la prop de contexto", () => {
    expect(headerSrc).toContain("renderPublicHeaderHtml({");
    expect(publicShellSrc).toContain("headerActionsHtml(context, base)");
    expect(headerSrc).toContain("context?: HeaderContext");
  });

  it("la pagina [slug] deriva el contexto del arbol y se lo pasa a BaseLayout", () => {
    expect(slugPageSrc).toContain("deriveHeaderContext(layout.root)");
    expect(slugPageSrc).toContain("headerContext={headerContext}");
  });

  it("BaseLayout recibe el contexto, lo pasa al Header y trae el listener de volumen", () => {
    expect(baseLayoutSrc).toContain("headerContext?: import(\"../lib/atomic-responsive-icons\").HeaderContext");
    expect(baseLayoutSrc).toContain("<Header context={headerContext} locale=");
    expect(baseLayoutSrc).toContain("VOLUME_LISTENER_SCRIPT");
    expect(baseLayoutSrc).toContain("set:html={VOLUME_LISTENER_SCRIPT}");
  });

  it("el shell runtime deriva con la MISMA funcion y emite el mismo rincon", () => {
    expect(shellSrc).toContain("deriveHeaderContext(layout.root)");
    expect(shellSrc).toContain("context: deriveHeaderContext(layout.root)");
    expect(publicShellSrc).toContain("headerActionsHtml(context, base)");
    expect(shellSrc).toContain("VOLUME_LISTENER_SCRIPT");
  });

  it("el CSS de ambos emisores pinta el rincon (margin-left:auto + botones redondos)", () => {
    const cssSrc = readFileSync(join(root, "src/styles/global.css"), "utf8");
    expect(cssSrc).toContain(".header-actions");
    expect(cssSrc).toContain(".header-icon-btn");
    expect(cssSrc).toContain("margin-left: auto");
    expect(shellSrc).toContain("margin-left:auto");
    expect(shellSrc).toContain(".header-icon-btn[aria-pressed=\"true\"]");
  });
});

describe("share iOS + control de volumen", () => {
  it("el ProfileHeader NO trae boton share: el share es solo del rincon del header", () => {
    const profileHtml = elementRegistry.ProfileHeader.renderHTML({
      avatarUrl: "/avatars/jerry-bantz.svg",
      name: "Jerry Bantz",
      bio: "Musica nueva todas las semanas.",
      bgColor: "#261C15",
    });
    expect(profileHtml).not.toContain("data-portaless-share");
    expect(profileHtml).not.toContain("ae-share");
  });

  it("el icono iOS tiene stroke 1.5 (caja fina legible a 16px)", () => {
    expect(ICON_SHARE_IOS).toContain('stroke-width="1.5"');
    expect(ICON_SHARE_IOS).toContain('stroke="currentColor"');
  });

  it("el embed de YouTube trae enablejsapi=1 y la clase ae-video que el listener busca", () => {
    const videoHtml = elementRegistry.Video.renderHTML({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Video",
      radius: 16,
    });
    expect(videoHtml).toContain("enablejsapi=1");
    expect(videoHtml).toContain('class="ae-video"');
    const vimeoHtml = elementRegistry.Video.renderHTML({
      url: "https://vimeo.com/123456",
      title: "Video",
      radius: 16,
    });
    expect(vimeoHtml).toContain('class="ae-video"');
  });

  it("el elemento Map emite iframe de OpenStreetMap y enlace Cómo llegar", () => {
    const mapHtml = elementRegistry.Map.renderHTML({
      lat: -33.4372,
      lon: -70.6506,
      label: "Estudio Jerry",
      address: "Santiago",
      zoom: 15,
      radius: 16,
    });
    expect(mapHtml).toContain("openstreetmap.org/export/embed.html");
    expect(mapHtml).toContain("openstreetmap.org/directions");
    expect(mapHtml).toContain('id="ae-map"');
    expect(mapHtml).toContain("Estudio Jerry");
  });

  it("el elemento ProductCard soporta enlaces de afiliados (sponsored noopener) y locales", () => {
    const affHtml = elementRegistry.ProductCard.renderHTML({
      title: "Micrófono Shure SM7B",
      price: "$399 USD",
      url: "https://www.amazon.com/dp/B000SHZ56U",
      buttonLabel: "Ver en Amazon",
      badge: "Afiliado",
    });
    expect(affHtml).toContain('rel="sponsored noopener noreferrer"');
    expect(affHtml).toContain("Micrófono Shure SM7B");
    expect(affHtml).toContain("$399 USD");
    expect(affHtml).toContain("Ver en Amazon");

    const localHtml = elementRegistry.ProductCard.renderHTML({
      title: "Merch Oficial",
      url: "/shop/polera",
      buttonLabel: "Comprar",
    });
    expect(localHtml).not.toContain("sponsored");
    expect(localHtml).toContain('href="/shop/polera"');
  });

  it("el listener de volumen habla con YouTube y Vimeo via postMessage, sin handlers inline", () => {
    // El cuerpo del listener vive en UNA sola fuente (el modulo
    // compartido); los dos emisores solo lo cablean via
    // VOLUME_LISTENER_SCRIPT. Asi no hay dos scripts que driftar.
    const libSrc = readFileSync(join(root, "src/lib/atomic-responsive-icons.ts"), "utf8");
    expect(libSrc).toContain("[data-portaless-volume]");
    expect(libSrc).toContain("postMessage");
    expect(libSrc).toContain('event: "command"');
    expect(libSrc).toContain('method: "setVolume"');
    expect(libSrc).toContain(".ae-video iframe");
    expect(baseLayoutSrc).toContain("VOLUME_LISTENER_SCRIPT");
    expect(shellSrc).toContain("VOLUME_LISTENER_SCRIPT");
    expect(baseLayoutSrc).not.toContain("onclick");
    expect(shellSrc).not.toContain("onclick");
  });
});
