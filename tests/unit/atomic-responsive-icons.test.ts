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
} from "../../src/lib/atomic-responsive-icons";
import {
  ICON_DIRECTIONS,
  ICON_SHARE_IOS,
  ICON_SHOPPING_CART,
  ICON_VOLUME_2,
} from "../../packages/atomic-elements/src/elements/icons";
import { elementRegistry } from "../../packages/atomic-elements/src/elements/registry";

const root = join(__dirname, "../..");
const headerSrc = readFileSync(join(root, "src/components/Header.astro"), "utf8");
const baseLayoutSrc = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");
const slugPageSrc = readFileSync(join(root, "src/pages/paginas/[slug].astro"), "utf8");
const shellSrc = readFileSync(join(root, "functions/paginas/[slug].js"), "utf8");

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
    expect(html).not.toContain("/tienda/");
    expect(html).not.toContain('cx="18" cy="5"');
  });

  it("shop: carrito primero (a /tienda/) y share al lado", () => {
    const html = headerActionsHtml("shop");
    expect(html).toContain('href="/tienda/"');
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
    expect(headerActionsHtml("shop", "/sub/")).toContain('href="/sub/tienda/"');
  });
});

describe("rincon del header -- wiring estatico y runtime", () => {
  it("Header.astro usa la fuente unica y expone la prop de contexto", () => {
    expect(headerSrc).toContain("headerActionsHtml(context, base)");
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
    expect(shellSrc).toContain("headerActionsHtml(deriveHeaderContext(layout.root))");
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
      url: "/tienda/polera",
      buttonLabel: "Comprar",
    });
    expect(localHtml).not.toContain("sponsored");
    expect(localHtml).toContain('href="/tienda/polera"');
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
