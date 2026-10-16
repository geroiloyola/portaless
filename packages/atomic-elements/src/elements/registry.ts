import type { ElementDefinition, ElementType } from "../types";
import {
  ICON_CIRCLE_QUESTION_MARK,
  ICON_CIRCLE_USER_ROUND,
  ICON_COLUMNS_2,
  ICON_DIRECTIONS,
  ICON_HEADING,
  ICON_IMAGE,
  ICON_IMAGES,
  ICON_LAYOUT_TEMPLATE,
  ICON_LINK,
  ICON_MAIL,
  ICON_MAP,
  ICON_MESSAGE_SQUARE_QUOTE,
  ICON_MOUSE_POINTER_CLICK,
  ICON_MOVE_VERTICAL,
  ICON_PILCROW,
  ICON_SHARE_2,
  ICON_SHOPPING_CART,
  ICON_STORE,
  ICON_VIDEO,
} from "./icons";

// Phase 0 (visual identity foundation): los colores de SISTEMA del
// renderHTML usan var(--token, fallback) con los fallbacks de la paleta
// oficial (#C5D86D / #261C15 / #F7F7F2 / #E4E6C3), asi el HTML emitido
// responde al skin activo (global.css / api/site-skin) en vez de traer
// hex pegados. Los colores EDITABLES por el usuario (bgColor del Hero o
// del Perfil) siguen siendo literales: son datos del contenido, no del
// tema. Regla de contraste: el lima puro #C5D86D no se usa COMO TEXTO
// sobre fondo claro -- ahi va --accent-text (o tinta #261C15 sobre el
// fondo lima de los botones solidos).

/**
 * RITMO (ROADMAP.md fase 13). Todo el padding del registro sale de una escala
 * de 8 pasos definida en global.css, NO de DesignTokens: un theme pack
 * controla IDENTIDAD (color, radio, densidad), no ritmo, y meter la escala
 * en DesignTokens obligaria a cada pack a declarar espaciado y romperia la
 * paridad de 16 variables fijada por test (theme-pack.test.ts). Mismo
 * precedente que --radius-button / --radius-input.
 *
 * Cada paso se emite como var(--space-N, <literal>px): el fallback conserva
 * el valor exacto si el CSS no esta cargado (build estatico, canvas del
 * editor) y nunca depende del orden de carga. El literal SIEMPRE coincide
 * con el valor real del paso -- un fallback que miente es una bomba de reloj,
 * y el test de fuente lo verifica.
 */
const SPACE_STEPS = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;
type SpaceStep = keyof typeof SPACE_STEPS;

function space(step: SpaceStep): string {
  return `var(--space-${step}, ${SPACE_STEPS[step]}px)`;
}

/**
 * Radio por ROL. Los atomos no emiten mas un radio crudo: cada superficie
 * toma el rol que le corresponde (media / card / panel) y el CSS decide.
 */
function radiusMedia(): string { return "var(--radius-media, 12px)"; }
function radiusCard(): string { return "var(--radius-card, 16px)"; }
function radiusPanel(): string { return "var(--radius-panel, 22px)"; }

/** Radio elegido por el usuario (prop number): se lleva al rol mas cercano en
 * vez de emitir un literal, para no romper el ritmo. */
function radiusFor(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return radiusCard();
  if (n <= 12) return radiusMedia();
  if (n <= 18) return radiusCard();
  return radiusPanel();
}

/**
 * Una variante es una FORMA del elemento, no un adorno: si dos valores solo
 * cambian color o padding, eso lo hacen los tokens del tema. El nombre de cada
 * valor es una palabra que un no tecnico entiende en el desplegable
 * (optionLabels en types.ts).
 *
 * Valor desconocido -> default. Mismo criterio fail-safe que un theme pack
 * que no resuelve: se cae al look conocido en vez de romper el render por un
 * dato que no es nuestro.
 */
function variantOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * TAMAÑOS (ROADMAP.md fase 13). `size` es un campo propio, NO parte de la
 * variante: por variante serian 3x3 = 9 opciones por elemento y el panel
 * queda inmanejable; asi son 3 + 3.
 *
 * Solo lo llevan los tres elementos donde dos instancias en la MISMA pagina
 * pueden necesitar escalas distintas (Hero, Heading, Button). En ProductCard,
 * Testimonial o Form el tamano lo define la variante, y duplicarlo seria dos
 * formas de decir lo mismo.
 *
 * REGLA: size no cambia semantica. Heading.size es visual y Heading.level es
 * semantico, y no se tocan -- un h2 con size lg es un encabezado de seccion
 * grande, correcto y accesible. Nunca hay que subir a h1 por tamano.
 */
export type ElementSize = "sm" | "md" | "lg";
const ELEMENT_SIZES = ["sm", "md", "lg"] as const satisfies readonly ElementSize[];
const ELEMENT_SIZE_LABELS: Record<string, string> = {
  sm: "Chico",
  md: "Mediano (el de siempre)",
  lg: "Grande",
};

/**
 * Titulo del Hero, absoluto: md = 2.2rem, el valor que emitia el Hero a mano.
 */
const HERO_TITLE_SIZES: Record<ElementSize, string> = {
  sm: "1.9rem",
  md: "2.2rem",
  lg: "var(--fs-display, 3.2rem)",
};

/**
 * Titulo del Heading. md = "" a proposito: el render historico NO fijaba
 * font-size y dejaba que la cascada h1/h2/h3 decidiera (global.css). sm es
 * relativo (.85em) para composar con cualquier nivel -- un "chico" de h3 no
 * puede ser mas grande que el h3 normal -- y lg es el tope de la escala.
 * sm < md < lg para cualquier nivel, incluido h1.
 */
const HEADING_SIZES: Record<ElementSize, string> = {
  sm: "font-size:.85em;",
  md: "",
  lg: "font-size:var(--fs-display, 3.2rem);",
};

/** Relleno del boton por tamano. md conserva el padding historico 10px 22px,
 * normalizado a los pasos mas cercanos de la escala (12px 24px). */
const BUTTON_SIZES: Record<ElementSize, string> = {
  sm: `${space(2)} ${space(4)}`,
  md: `${space(3)} ${space(5)}`,
  lg: `${space(4)} ${space(6)}`,
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

type HeroVariant = "centered" | "split" | "minimal";
const HERO_VARIANTS = ["centered", "split", "minimal"] as const satisfies readonly HeroVariant[];

interface HeroProps {
  title: string;
  subtitle: string;
  bgColor: string;
  /** Forma del hero. centered = el render historico. */
  variant?: HeroVariant;
  /**
   * Escala visual del titulo. NO cambia la semantica: sigue siendo un <h1>,
   * porque es el titulo principal de la seccion. Si un dia hace falta que sea
   * el titulo del documento, eso lo decide el nivel del documento, no el
   * tamano.
   */
  size?: ElementSize;
  /** Solo la usa la variante split. */
  imageUrl?: string;
}
const Hero: ElementDefinition<HeroProps> = {
  type: "Hero", displayName: "Hero / Portada", icon: ICON_LAYOUT_TEMPLATE,
  defaultProps: { title: "Titulo principal", subtitle: "Subtitulo de apoyo", bgColor: "#261C15", variant: "centered", size: "md" },
  editableProps: [
    { key: "title", label: "Titulo", kind: "text" },
    { key: "subtitle", label: "Subtitulo", kind: "textarea" },
    { key: "variant", label: "Forma", kind: "select", options: [...HERO_VARIANTS], optionLabels: {
      centered: "Centrado (el clasico)",
      split: "Texto a la izquierda, imagen a la derecha",
      minimal: "Sin fondo, tipografia grande",
    } },
    { key: "size", label: "Tamanio del titulo", kind: "select", options: [...ELEMENT_SIZES], optionLabels: ELEMENT_SIZE_LABELS },
    { key: "imageUrl", label: "URL de la imagen (variante split)", kind: "url" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  renderHTML: (p) => {
    const variant = variantOf(p.variant, HERO_VARIANTS, "centered");
    const size = variantOf(p.size, ELEMENT_SIZES, "md");
    const titleSize = HERO_TITLE_SIZES[size];

    if (variant === "minimal") {
      // Sin fondo ni caja: la tipografia hace el trabajo.
      return `<section style="padding:${space(8)} ${space(6)};text-align:left;"><h1 style="font-size:${titleSize};margin:0 0 ${space(3)};color:var(--text, #261C15);">${esc(p.title)}</h1><p style="opacity:.85;margin:0;font-size:var(--fs-body, 1rem);">${esc(p.subtitle)}</p></section>`;
    }

    if (variant === "split" && String(p.imageUrl ?? "").trim()) {
      const img = `<img src="${esc(p.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:${radiusCard()};display:block;" loading="lazy" />`;
      return `<section style="background:${esc(p.bgColor)};padding:${space(6)} ${space(5)};border-radius:${radiusPanel()};color:#fff;display:flex;gap:${space(5)};align-items:center;text-align:left;flex-wrap:wrap;"><div style="flex:1 1 260px;min-width:0;"><h1 style="font-size:${titleSize};margin:0 0 ${space(3)};">${esc(p.title)}</h1><p style="opacity:.85;margin:0;font-size:var(--fs-body, 1rem);">${esc(p.subtitle)}</p></div><div style="flex:1 1 260px;min-width:0;">${img}</div></section>`;
    }

    // centered, y tambien split sin imageUrl: cae al clasico en vez de
    // renderizar un hueco vacio.
    return `<section style="background:${esc(p.bgColor)};padding:${space(8)} ${space(6)};border-radius:${radiusPanel()};color:#fff;text-align:center;"><h1 style="font-size:${titleSize};margin:0 0 ${space(2)};">${esc(p.title)}</h1><p style="opacity:.85;margin:0;">${esc(p.subtitle)}</p></section>`;
  },
};

type HeadingVariant = "plain" | "eyebrow" | "ruled";
const HEADING_VARIANTS = ["plain", "eyebrow", "ruled"] as const satisfies readonly HeadingVariant[];

interface HeadingProps {
  text: string;
  /**
   * Nivel SEMANTICO del documento. No se toca nunca por tamano: un h2 con
   * size lg sigue siendo un h2, y es correcto. El error clasico (subir a h1
   * "porque se ve mas grande") rompe la jerarquia del documento y el
   * significado para lectores de pantalla; por eso size y level son campos
   * separados y no se tocan entre si.
   */
  level: "h1" | "h2" | "h3";
  align: "left" | "center" | "right";
  /** Forma del encabezado. plain = el render historico. */
  variant?: HeadingVariant;
  /** Escala visual, independiente del nivel semantico (ver arriba). */
  size?: ElementSize;
  /** Antetitulo, solo para la variante eyebrow. */
  eyebrow?: string;
}
const Heading: ElementDefinition<HeadingProps> = {
  type: "Heading", displayName: "Encabezado", icon: ICON_HEADING,
  defaultProps: { text: "Encabezado de seccion", level: "h2", align: "left", variant: "plain", size: "md" },
  editableProps: [
    { key: "text", label: "Texto", kind: "text" },
    { key: "level", label: "Nivel", kind: "select", options: ["h1", "h2", "h3"], optionLabels: {
      h1: "h1 - Titulo principal de la pagina",
      h2: "h2 - Titulo de seccion",
      h3: "h3 - Subtitulo",
    } },
    { key: "variant", label: "Forma", kind: "select", options: [...HEADING_VARIANTS], optionLabels: {
      plain: "Simple",
      eyebrow: "Con antetitulo encima",
      ruled: "Con linea divisoria debajo",
    } },
    { key: "size", label: "Tamanio", kind: "select", options: [...ELEMENT_SIZES], optionLabels: ELEMENT_SIZE_LABELS },
    { key: "eyebrow", label: "Antetitulo (variante con antetitulo)", kind: "text" },
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center", "right"], optionLabels: {
      left: "Izquierda",
      center: "Centro",
      right: "Derecha",
    } },
  ],
  renderHTML: (p) => {
    const variant = variantOf(p.variant, HEADING_VARIANTS, "plain");
    const size = variantOf(p.size, ELEMENT_SIZES, "md");
    const level = p.level ?? "h2";
    const fontSize = HEADING_SIZES[size];
    const style = `text-align:${p.align};margin:0;${fontSize ? `font-size:${fontSize};` : ""}`;
    const pre = variant === "eyebrow" && String(p.eyebrow ?? "").trim()
      ? `<span style="display:block;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--accent-text, #5A6B24);margin:0 0 ${space(1)};">${esc(p.eyebrow)}</span>`
      : "";
    const post = variant === "ruled" ? `border-bottom:1px solid var(--panel-border, #E4E6C3);padding-bottom:${space(2)};` : "";
    return `${pre}<${level} style="${style}${post}">${esc(p.text)}</${level}>`;
  },
};

interface ParagraphProps { text: string; }
const Paragraph: ElementDefinition<ParagraphProps> = {
  type: "Paragraph", displayName: "Parrafo", icon: ICON_PILCROW,
  defaultProps: { text: "Escribe aqui el contenido de este parrafo." },
  editableProps: [{ key: "text", label: "Texto", kind: "textarea" }],
  renderHTML: (p) => `<p style="line-height:1.6;margin:0;">${esc(p.text)}</p>`,
};

interface ImageProps { src: string; alt: string; radius: number; }
const ImageEl: ElementDefinition<ImageProps> = {
  type: "Image", displayName: "Imagen", icon: ICON_IMAGE,
  defaultProps: { src: "https://placehold.co/800x400", alt: "Descripcion de la imagen", radius: 16 },
  editableProps: [
    { key: "src", label: "URL de la imagen", kind: "url" },
    { key: "alt", label: "Texto alternativo", kind: "text" },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) => `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="width:100%;border-radius:${radiusFor(p.radius)};display:block;" loading="lazy" />`,
};

type ButtonVariant = "solid" | "outline" | "ghost";
const BUTTON_VARIANTS = ["solid", "outline", "ghost"] as const satisfies readonly ButtonVariant[];

interface ButtonProps {
  label: string;
  href: string;
  /** Forma del boton. */
  variant?: ButtonVariant;
  /** Escala del relleno. */
  size?: ElementSize;
  /**
   * LEGADO (v0.0.9.x): "primary" | "secondary". Se sigue leyendo para que las
   * paginas ya guardadas sigan renderizando igual, pero deja de ser editable:
   * `variant` lo reemplaza y tener las dos cosas editables seria dos formas de
   * decir lo mismo. primary -> solid, secondary -> outline.
   */
  style?: "primary" | "secondary";
}
const ButtonEl: ElementDefinition<ButtonProps> = {
  type: "Button", displayName: "Boton", icon: ICON_MOUSE_POINTER_CLICK,
  defaultProps: { label: "Llamado a la accion", href: "#", variant: "solid", size: "md" },
  editableProps: [
    { key: "label", label: "Texto", kind: "text" },
    { key: "href", label: "Enlace", kind: "url" },
    { key: "variant", label: "Forma", kind: "select", options: [...BUTTON_VARIANTS], optionLabels: {
      solid: "Solido (relleno)",
      outline: "Con borde",
      ghost: "Solo texto",
    } },
    { key: "size", label: "Tamanio", kind: "select", options: [...ELEMENT_SIZES], optionLabels: ELEMENT_SIZE_LABELS },
  ],
  renderHTML: (p) => {
    // Back-compat: una pagina guardada con `style` sigue honrandola. Si el
    // layout nuevo trae `variant`, manda el variant.
    const legacy = p.style === "secondary" ? "outline" : p.style === "primary" ? "solid" : undefined;
    const variant = variantOf(p.variant ?? legacy, BUTTON_VARIANTS, "solid");
    const size = variantOf(p.size, ELEMENT_SIZES, "md");

    // Cada variante conserva contraste AA: solido usa tinta sobre el acento
    // claro; outline y ghost usan --accent-text, que es el acento legible
    // sobre fondos claros (el lima puro no alcanza AA como texto).
    let bg: string, color: string, border: string;
    if (variant === "solid") {
      bg = "var(--accent, #C5D86D)";
      color = "#261C15";
      border = "none";
    } else if (variant === "outline") {
      bg = "transparent";
      color = "var(--accent-text, #5A6B24)";
      border = "1px solid var(--accent, #C5D86D)";
    } else {
      bg = "transparent";
      color = "var(--accent-text, #5A6B24)";
      border = "none";
    }
    return `<a href="${esc(p.href)}" style="display:inline-block;padding:${BUTTON_SIZES[size]};border-radius:var(--radius-button, 8px);background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;">${esc(p.label)}</a>`;
  },
};

interface ColumnsProps { count: 2 | 3; gap: number; }
const Columns: ElementDefinition<ColumnsProps> = {
  type: "Columns", displayName: "Columnas", icon: ICON_COLUMNS_2,
  defaultProps: { count: 2, gap: 16 },
  editableProps: [
    { key: "count", label: "Numero de columnas", kind: "select", options: ["2", "3"], optionLabels: { "2": "2 columnas", "3": "3 columnas" } },
    { key: "gap", label: "Espaciado", kind: "number" },
  ],
  renderHTML: (p, children = "") => `<div class="ae-columns" style="display:grid;grid-template-columns:repeat(${p.count},1fr);gap:${Number(p.gap) >= 24 ? space(5) : space(4)};align-items:start;">${children}</div>`,
};

interface ProductGridProps { source: "medusa" | "manual"; columns: number; limit: number; }
const ProductGrid: ElementDefinition<ProductGridProps> = {
  type: "ProductGrid", displayName: "Grilla de productos", icon: ICON_SHOPPING_CART,
  defaultProps: { source: "medusa", columns: 3, limit: 6 },
  editableProps: [
    { key: "source", label: "Origen de datos", kind: "select", options: ["medusa", "manual"], optionLabels: { medusa: "Catalogo Medusa", manual: "Productos escritos a mano" } },
    { key: "columns", label: "Columnas", kind: "number" },
    { key: "limit", label: "Maximo de productos", kind: "number" },
  ],
  renderHTML: (p) => `<div class="ae-product-grid" data-source="${esc(p.source)}" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:${space(4)};"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Vista previa del editor - el catalogo real de ${esc(p.source)} se carga en el build de produccion</div></div>`,
  renderHTMLAsync: async (p) => {
    if (p.source !== "medusa") {
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:${space(4)};"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Origen "manual" seleccionado - agrega tus productos editando el JSON de la pagina.</div></div>`;
    }
    try {
      const { isCommerceEnabled, fetchProducts, formatPrice } = await import(/* @vite-ignore */ "../../../../src/commerce/medusa-client");
      const enabled = await isCommerceEnabled();
      if (!enabled) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:${space(4)};"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Modulo de comercio desactivado. Define ENABLE_COMMERCE=true y src/commerce/config.ts para mostrar productos reales aqui.</div></div>`;
      }
      const products = (await fetchProducts()).slice(0, p.limit);
      if (products.length === 0) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:${space(4)};"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Tu tienda Medusa/Mercur no tiene productos publicados todavia.</div></div>`;
      }
      const prefix = ((p as any).base && (p as any).base !== "/") ? (p as any).base.replace(/\/$/, "") : "";
      const cards = products.map((product: any) => `<a href="${prefix}/tienda/${esc(product.handle)}" style="display:block;border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};overflow:hidden;text-decoration:none;color:inherit;">${product.thumbnail ? `<img src="${esc(product.thumbnail)}" alt="${esc(product.title)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" />` : ""}<div style="padding:${space(3)};"><h4 style="margin:0 0 ${space(1)};font-size:14px;">${esc(product.title)}</h4><p style="margin:0;font-weight:700;color:var(--accent-text, #5A6B24);">${esc(formatPrice(product))}</p></div></a>`).join("");
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:${space(4)};">${cards}</div>`;
    } catch (err) {
      return `<div class="ae-product-grid" style="border:1px dashed var(--danger-fg, #B3372C);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--danger-fg, #B3372C);">Error cargando productos: ${esc((err as Error).message)}</div>`;
    }
  },
};

interface SpacerProps { height: number; }
const Spacer: ElementDefinition<SpacerProps> = {
  type: "Spacer", displayName: "Espaciador", icon: ICON_MOVE_VERTICAL,
  defaultProps: { height: 32 },
  editableProps: [{ key: "height", label: "Altura (px)", kind: "number" }],
  renderHTML: (p) => `<div style="height:${esc(p.height)}px;"></div>`,
};

interface LinkItem { label: string; url: string; icon?: string; enabled: boolean; }
interface LinkListProps { title: string; links: LinkItem[]; buttonStyle: "solid" | "outline"; }
const LinkList: ElementDefinition<LinkListProps> = {
  type: "LinkList", displayName: "Lista de enlaces", icon: ICON_LINK,
  defaultProps: {
    title: "Mis enlaces",
    links: [
      { label: "Mi Instagram", url: "https://instagram.com/", icon: "instagram", enabled: true },
      { label: "Mi tienda", url: "https://", icon: "store", enabled: true },
    ],
    buttonStyle: "solid",
  },
  editableProps: [
    { key: "title", label: "Titulo (opcional)", kind: "text" },
    { key: "buttonStyle", label: "Estilo de boton", kind: "select", options: ["solid", "outline"], optionLabels: { solid: "Solido (relleno)", outline: "Con borde" } },
  ],
  renderHTML: (p) => {
    const visible = p.links.filter((l) => l.enabled);
    const items = visible
      .map((l) => {
        const bg = p.buttonStyle === "solid" ? "var(--accent, #C5D86D)" : "transparent";
        const color = p.buttonStyle === "solid" ? "#261C15" : "var(--accent-text, #5A6B24)";
        const border = p.buttonStyle === "solid" ? "none" : "1px solid var(--accent, #C5D86D)";
        return `<a href="${esc(l.url)}" style="display:block;padding:${space(4)} ${space(5)};border-radius:${radiusCard()};background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;text-align:center;margin-bottom:${space(2)};">${esc(l.label)}</a>`;
      })
      .join("");
    const heading = p.title ? `<h3 style="text-align:center;margin:0 0 ${space(4)};">${esc(p.title)}</h3>` : "";
    return `<div class="ae-link-list" style="max-width:480px;margin:0 auto;">${heading}${items}</div>`;
  },
};

interface SocialIconsProps { links: Array<{ platform: string; url: string }>; align: "left" | "center" | "right"; }
const SocialIcons: ElementDefinition<SocialIconsProps> = {
  type: "SocialIcons", displayName: "Iconos sociales", icon: ICON_SHARE_2,
  defaultProps: {
    links: [
      { platform: "instagram", url: "https://instagram.com/" },
      { platform: "tiktok", url: "https://tiktok.com/@" },
    ],
    align: "center",
  },
  editableProps: [
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center", "right"], optionLabels: {
      left: "Izquierda",
      center: "Centro",
      right: "Derecha",
    } },
  ],
  renderHTML: (p) => {
    const icons = p.links
      .map(
        (l) =>
          `<a href="${esc(l.url)}" aria-label="${esc(l.platform)}" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);border:1px solid var(--panel-border, #E4E6C3);text-decoration:none;margin:0 ${space(2)};font-size:0.75rem;">${esc(l.platform.slice(0, 2).toUpperCase())}</a>`
      )
      .join("");
    return `<div class="ae-social-icons" style="text-align:${p.align};">${icons}</div>`;
  },
};

interface ProfileHeaderProps { avatarUrl: string; name: string; bio: string; bgColor: string; }
const ProfileHeader: ElementDefinition<ProfileHeaderProps> = {
  type: "ProfileHeader", displayName: "Perfil / Bio", icon: ICON_CIRCLE_USER_ROUND,
  defaultProps: {
    avatarUrl: "https://placehold.co/160x160",
    name: "Tu nombre",
    bio: "Una linea corta sobre ti o tu marca.",
    bgColor: "#261C15",
  },
  editableProps: [
    { key: "avatarUrl", label: "URL del avatar", kind: "url" },
    { key: "name", label: "Nombre", kind: "text" },
    { key: "bio", label: "Bio corta", kind: "textarea" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  // El compartir NO vive aqui: el boton share del sitio esta UNA sola
  // vez, en el rincon del header (Atomic Icons Responsive, ver
  // src/lib/atomic-responsive-icons.ts). Antes de esa pieza el boton
  // vivia anclado arriba a la derecha de esta tarjeta y quedaba el
  // doble share (header + bio); el header es el unico dueño ahora.
  renderHTML: (p) => `<section style="background:${esc(p.bgColor)};padding:${space(6)} ${space(5)};border-radius:${radiusPanel()};text-align:center;color:#fff;"><img src="${esc(p.avatarUrl)}" alt="${esc(p.name)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto ${space(3)};display:block;" loading="lazy" /><h2 style="margin:0 0 ${space(1)};font-size:1.3rem;">${esc(p.name)}</h2><p style="opacity:.85;margin:0;font-size:0.95rem;">${esc(p.bio)}</p></section>`,
};

interface StoreBlockProps { columns: number; limit: number; }
const StoreBlock: ElementDefinition<StoreBlockProps> = {
  type: "StoreBlock", displayName: "Tienda de afiliados", icon: ICON_STORE,
  defaultProps: { columns: 2, limit: 6 },
  editableProps: [
    { key: "columns", label: "Columnas", kind: "number" },
    { key: "limit", label: "Maximo de productos", kind: "number" },
  ],
  renderHTML: (p) =>
    ProductGrid.renderHTML({ source: "manual", columns: p.columns, limit: p.limit }),
};

interface VideoProps { url: string; title: string; radius: number; }
const Video: ElementDefinition<VideoProps> = {
  type: "Video", displayName: "Video (embed)", icon: ICON_VIDEO,
  defaultProps: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Video embebido", radius: 16 },
  editableProps: [
    { key: "url", label: "URL de YouTube o Vimeo", kind: "url" },
    { key: "title", label: "Titulo (accesibilidad)", kind: "text" },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) => {
    const url = String(p.url ?? "").trim();
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    const vimeo = url.match(/vimeo\.com\/(\d+)/);
    const radius = radiusFor(p.radius);
    if (yt) {
      // enablejsapi=1: habilita los comandos postMessage del IFrame API
      // que el control de volumen del rincon del header (Atomic Icons
      // Responsive) envia para silenciar/des-silenciar. Sin el parametro
      // YouTube ignora los comandos. La clase ae-video es el selector
      // con que el listener localiza los players de la pagina.
      return `<figure class="ae-video" style="margin:0;position:relative;border-radius:${radius};overflow:hidden;aspect-ratio:16/9;background:var(--panel-border, #E4E6C3);"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt[1])}?enablejsapi=1" title="${esc(p.title)}" loading="lazy" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe></figure>`;
    }
    if (vimeo) {
      return `<figure class="ae-video" style="margin:0;position:relative;border-radius:${radius};overflow:hidden;aspect-ratio:16/9;background:var(--panel-border, #E4E6C3);"><iframe src="https://player.vimeo.com/video/${esc(vimeo[1])}" title="${esc(p.title)}" loading="lazy" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe></figure>`;
    }
    return `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radius};padding:${space(6)};text-align:center;color:var(--muted, #6E6653);">URL no reconocida - pega un enlace de YouTube (youtube.com/watch, youtu.be o shorts) o Vimeo (vimeo.com).</div>`;
  },
};

type FaqVariant = "list" | "bordered" | "numbered";
const FAQ_VARIANTS = ["list", "bordered", "numbered"] as const satisfies readonly FaqVariant[];

interface FAQProps {
  title: string;
  items: string;
  /**
   * Forma de la lista. El marcador (la flecha nativa del <details>) NO es una
   * prop: sigue a la variante. Agregarlo como select seria un control mas que
   * nadie sabe cuando tocar -- y nadie necesita.
   */
  variant?: FaqVariant;
}
const FAQ: ElementDefinition<FAQProps> = {
  type: "FAQ", displayName: "Preguntas frecuentes", icon: ICON_CIRCLE_QUESTION_MARK,
  defaultProps: {
    title: "Preguntas frecuentes",
    items: "¿Cuanto tarda el envio? :: Entre 2 y 5 dias habiles.\n¿Puedo devolver el producto? :: Si, tenes 30 dias.",
    variant: "list",
  },
  editableProps: [
    { key: "title", label: "Titulo de la seccion", kind: "text" },
    { key: "variant", label: "Forma", kind: "select", options: [...FAQ_VARIANTS], optionLabels: {
      list: "Lista con tarjetas (la de siempre)",
      bordered: "Lista plana con separadores",
      numbered: "Lista numerada",
    } },
    { key: "items", label: "Preguntas (una por linea: Pregunta :: Respuesta)", kind: "textarea" },
  ],
  renderHTML: (p) => {
    const variant = variantOf(p.variant, FAQ_VARIANTS, "list");
    const parsed = String(p.items ?? "")
      .split("\n")
      .map((line) => line.split("::"))
      .filter((parts) => (parts[0] ?? "").trim());

    // El marcador sigue a la variante y no es una prop: `list` y `bordered`
    // dejan el <details> nativo (la flecha del navegador, que ya funciona sin
    // JS); `numbered` agrega el numero de orden como texto visible.
    const body = (q: string, answer: string) =>
      `<summary style="padding:${space(4)};cursor:pointer;font-weight:700;">${esc(q)}</summary>` +
      `<div style="padding:0 ${space(4)} ${space(4)};line-height:1.6;color:var(--muted, #6E6653);">${esc(answer)}</div>`;

    const items = parsed
      .map(([q, ...rest], i) => {
        const answer = rest.join("::").trim();
        if (variant === "bordered") {
          return `<details style="border-bottom:1px solid var(--panel-border, #E4E6C3);">${body(q.trim(), answer)}</details>`;
        }
        if (variant === "numbered") {
          const n = `<span aria-hidden="true" style="display:inline-block;min-width:1.6em;font-variant-numeric:tabular-nums;color:var(--accent-text, #5A6B24);">${i + 1}.</span>`;
          return `<details style="border-bottom:1px solid var(--panel-border, #E4E6C3);"><summary style="padding:${space(3)} ${space(2)};cursor:pointer;font-weight:700;display:flex;gap:${space(2)};">${n}<span>${esc(q.trim())}</span></summary><div style="padding:0 ${space(4)} ${space(4)} ${space(7)};line-height:1.6;color:var(--muted, #6E6653);">${esc(answer)}</div></details>`;
        }
        return `<details style="border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};margin-bottom:${space(2)};background:var(--panel-bg, #FFFFFF);">${body(q.trim(), answer)}</details>`;
      })
      .join("");

    const heading = p.title ? `<h3 style="margin:0 0 ${space(4)};">${esc(p.title)}</h3>` : "";
    const empty = `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusMedia()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);">Agrega preguntas en el panel: una por linea con el formato \"Pregunta :: Respuesta\".</div>`;
    return `<section style="margin:0;">${heading}${items || empty}</section>`;
  },
};

type TestimonialVariant = "plain" | "quote" | "card";
const TESTIMONIAL_VARIANTS = ["plain", "quote", "card"] as const satisfies readonly TestimonialVariant[];

interface TestimonialProps {
  quote: string;
  author: string;
  role: string;
  avatarUrl: string;
  align: "left" | "center";
  /** Forma. plain = el render historico. */
  variant?: TestimonialVariant;
}
const Testimonial: ElementDefinition<TestimonialProps> = {
  type: "Testimonial", displayName: "Testimonio", icon: ICON_MESSAGE_SQUARE_QUOTE,
  defaultProps: {
    quote: "Trabajar con este equipo cambio la manera en que publicamos. Recomendado.",
    author: "Nombre del cliente",
    role: "Rol o empresa",
    avatarUrl: "https://placehold.co/96x96",
    align: "center",
    variant: "plain",
  },
  editableProps: [
    { key: "quote", label: "Cita", kind: "textarea" },
    { key: "author", label: "Autor", kind: "text" },
    { key: "role", label: "Rol o empresa", kind: "text" },
    { key: "avatarUrl", label: "URL del avatar", kind: "url" },
    { key: "variant", label: "Forma", kind: "select", options: [...TESTIMONIAL_VARIANTS], optionLabels: {
      plain: "Simple (el de siempre)",
      quote: "Con comilla grande",
      card: "En tarjeta con relieve",
    } },
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center"], optionLabels: {
      left: "Izquierda",
      center: "Centro",
    } },
  ],
  renderHTML: (p) => {
    const variant = variantOf(p.variant, TESTIMONIAL_VARIANTS, "plain");
    const avatar = p.avatarUrl
      ? `<img src="${esc(p.avatarUrl)}" alt="${esc(p.author)}" width="48" height="48" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-bottom:${space(3)};display:block;${p.align === "center" ? "margin-left:auto;margin-right:auto;" : ""}" loading="lazy" />`
      : "";
    const authorLine = p.author
      ? `<figcaption style="font-weight:700;">${esc(p.author)}${p.role ? `<span style="display:block;font-weight:400;color:var(--muted, #6E6653);font-size:.85rem;">${esc(p.role)}</span>` : ""}</figcaption>`
      : "";

    // quote: la comilla es TIPOGRAFICA -- un <span aria-hidden> con el caracter,
    // no un pseudo-elemento ni una imagen. El texto de la cita sigue siendo el
    // texto, para un lector de pantalla y para copiar.
    if (variant === "quote") {
      const mark = `<span aria-hidden="true" style="display:block;font-family:var(--font-display, Georgia, serif);font-size:3rem;line-height:1;color:var(--accent-text, #5A6B24);">&#8220;</span>`;
      return `<figure style="margin:0;text-align:${esc(p.align)};">${mark}${avatar}<blockquote style="margin:0 0 ${space(4)};line-height:1.6;font-size:1.15rem;">${esc(p.quote)}</blockquote>${authorLine}</figure>`;
    }

    // card: la superficie del tema (radio de panel) y relieve, en vez del borde
    // plano del render historico.
    if (variant === "card") {
      return `<figure style="margin:0;text-align:${esc(p.align)};border-radius:${radiusPanel()};padding:${space(6)};background:var(--panel-bg, #FFFFFF);box-shadow:var(--shadow-md, 0 4px 12px rgba(38,28,21,.08));">${avatar}<blockquote style="margin:0 0 ${space(4)};line-height:1.6;">${esc(p.quote)}</blockquote>${authorLine}</figure>`;
    }

    // plain: el render historico, byte a byte.
    return `<figure style="margin:0;text-align:${esc(p.align)};border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};padding:${space(5)};background:var(--panel-bg, #FFFFFF);">${avatar}<blockquote style="margin:0 0 ${space(3)};line-height:1.6;">${esc(p.quote)}</blockquote>${authorLine}</figure>`;
  },
};

type FormVariant = "stacked" | "inline";
const FORM_VARIANTS = ["stacked", "inline"] as const satisfies readonly FormVariant[];

interface FormProps {
  action: string;
  submitLabel: string;
  anchorId: string;
  /** Forma. stacked = campos apilados, el render historico. */
  variant?: FormVariant;
}
const FormEl: ElementDefinition<FormProps> = {
  type: "Form", displayName: "Formulario de contacto", icon: ICON_MAIL,
  defaultProps: { action: "", submitLabel: "Enviar mensaje", anchorId: "contacto", variant: "stacked" },
  editableProps: [
    { key: "action", label: "Endpoint (URL de Formspree, Basin, etc.)", kind: "url" },
    { key: "submitLabel", label: "Texto del boton", kind: "text" },
    { key: "variant", label: "Forma", kind: "select", options: [...FORM_VARIANTS], optionLabels: {
      stacked: "Campos apilados (vertical)",
      inline: "En una fila, con el boton al lado",
    } },
    { key: "anchorId", label: "Ancla (para botones #...)", kind: "text" },
  ],
  renderHTML: (p) => {
    const anchor = p.anchorId ? ` id="${esc(p.anchorId)}"` : "";
    const variant = variantOf(p.variant, FORM_VARIANTS, "stacked");
    const inline = variant === "inline";
    const fieldStyle = `width:100%;box-sizing:border-box;padding:${space(3)} ${space(4)};border:1px solid var(--panel-border, #E4E6C3);border-radius:var(--radius-input, 6px);font:inherit;background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);margin-bottom:${space(2)};`;
    const label = (text: string, inner: string) => `<label style="display:block;font-weight:700;font-size:.85rem;margin-bottom:${space(1)};">${text}${inner}</label>`;
    const submit = `<button type="submit" style="align-self:flex-start;padding:${BUTTON_SIZES.md};border-radius:var(--radius-button, 8px);border:none;background:var(--accent, #C5D86D);color:#261C15;font-weight:700;cursor:pointer;">${esc(p.submitLabel)}</button>`;

    if (!String(p.action ?? "").trim()) {
      return `<div${anchor} style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusCard()};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);">Este formulario todavia no entrega a ningun destino. Configura un endpoint (por ejemplo Formspree o Basin, ambos con plan gratuito) en la propiedad \"Endpoint\" y el formulario empezara a enviar mensajes reales.</div>`;
    }

    // inline: los campos en una fila y el boton al lado. El mensaje se queda
    // debajo y ocupa el ancho completo -- meter un textarea angosto al lado de
    // un boton es ilegible, no "compacto".
    if (inline) {
      return `<form${anchor} method="post" action="${esc(p.action)}" style="border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};padding:${space(5)};background:var(--panel-bg, #FFFFFF);"><div style="display:flex;gap:${space(3)};align-items:flex-end;flex-wrap:wrap;">${label("Nombre", `<input type="text" name="nombre" required style="${fieldStyle}flex:1 1 180px;margin-bottom:0;" />`)}${label("Email", `<input type="email" name="email" required style="${fieldStyle}flex:1 1 180px;margin-bottom:0;" />`)}${submit}</div>${label("Mensaje", `<textarea name="mensaje" rows="4" required style="${fieldStyle}resize:vertical;"></textarea>`)}</form>`;
    }

    return `<form${anchor} method="post" action="${esc(p.action)}" style="display:flex;flex-direction:column;border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};padding:${space(5)};background:var(--panel-bg, #FFFFFF);">${label("Nombre", `<input type="text" name="nombre" required style="${fieldStyle}" />`)}${label("Email", `<input type="email" name="email" required style="${fieldStyle}" />`)}${label("Mensaje", `<textarea name="mensaje" rows="5" required style="${fieldStyle}resize:vertical;"></textarea>`)}${submit}</form>`;
  },
};

type GalleryVariant = "grid" | "masonry";
const GALLERY_VARIANTS = ["grid", "masonry"] as const satisfies readonly GalleryVariant[];

interface GalleryProps {
  images: string;
  columns: 2 | 3 | 4;
  /**
   * Radio de borde (px). Antes se emitia como literal crudo y se saltaba el
   * radio por rol; ahora se lleva al rol mas cercano de la escala, asi que un
   * skin puede unificarlo. El valor sigue siendo editable por el usuario.
   */
  radius: number;
  /** Forma. grid = el render historico. masonry usa columnas CSS, sin JS. */
  variant?: GalleryVariant;
}
const Gallery: ElementDefinition<GalleryProps> = {
  type: "Gallery", displayName: "Galeria", icon: ICON_IMAGES,
  defaultProps: {
    images: "https://placehold.co/600x600\nhttps://placehold.co/600x600/C5D86D\nhttps://placehold.co/600x600/261C15",
    columns: 3,
    radius: 12,
    variant: "grid",
  },
  editableProps: [
    { key: "images", label: "Imagenes (una URL por linea)", kind: "textarea" },
    { key: "variant", label: "Forma", kind: "select", options: [...GALLERY_VARIANTS], optionLabels: {
      grid: "Grilla de cuadrados iguales",
      masonry: "Apilado en columnas",
    } },
    { key: "columns", label: "Columnas", kind: "select", options: ["2", "3", "4"], optionLabels: {
      "2": "2 columnas",
      "3": "3 columnas",
      "4": "4 columnas",
    } },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) => {
    const urls = String(p.images ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//.test(line) || line.startsWith("/"));
    if (urls.length === 0) {
      return `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radiusFor(p.radius)};padding:${space(5)};text-align:center;color:var(--muted, #6E6653);">Agrega imagenes en el panel: una URL por linea.</div>`;
    }
    const variant = variantOf(p.variant, GALLERY_VARIANTS, "grid");
    const cell = (url: string) => {
      const alt = decodeURIComponent(url.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_+]/g, " ") || "Imagen de la galeria";
      return `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:block;border-radius:${radiusFor(p.radius)};overflow:hidden;break-inside:avoid;"><img src="${esc(url)}" alt="${esc(alt)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" /></a>`;
    };
    const cells = urls.map(cell).join("");

    // masonry con multi-column de CSS: sin JS, sin JS que mantener, y el
    // orden de lectura sigue siendo el del DOM (column-flow, no reordenacion).
    if (variant === "masonry") {
      return `<div class="ae-gallery" style="column-count:${esc(p.columns)};column-gap:${space(4)};">${cells}</div>`;
    }
    return `<div class="ae-gallery" style="display:grid;grid-template-columns:repeat(${esc(p.columns)},1fr);gap:${space(3)};">${cells}</div>`;
  },
};

interface MapProps {
  lat: number;
  lon: number;
  label: string;
  address?: string;
  zoom?: number;
  radius?: number;
}
const MapEl: ElementDefinition<MapProps> = {
  type: "Map", displayName: "Mapa (OpenStreetMap)", icon: ICON_MAP,
  defaultProps: {
    lat: -33.4372,
    lon: -70.6506,
    label: "Ubicación",
    address: "Santiago, Chile",
    zoom: 15,
    radius: 16,
  },
  editableProps: [
    { key: "lat", label: "Latitud", kind: "number" },
    { key: "lon", label: "Longitud", kind: "number" },
    { key: "label", label: "Nombre del lugar", kind: "text" },
    { key: "address", label: "Dirección descriptiva", kind: "text" },
    { key: "zoom", label: "Zoom (1-19)", kind: "number" },
    { key: "radius", label: "Radio de borde (px)", kind: "number" },
  ],
  renderHTML: (p) => {
    const lat = Number(p.lat ?? -33.4372);
    const lon = Number(p.lon ?? -70.6506);
    const zoom = Math.min(19, Math.max(1, Number(p.zoom ?? 15)));
    const span = 360 / Math.pow(2, zoom);
    const bbox = `${lon - span},${lat - span / 2},${lon + span},${lat + span / 2}`;
    const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
    const dirUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=;${lat},${lon}`;
    const radius = radiusFor(p.radius);
    return `<figure id="ae-map" class="ae-map" style="margin:0;position:relative;border-radius:${radius};overflow:hidden;border:1px solid var(--panel-border, #E4E6C3);background:var(--panel-bg, #FFFFFF);"><iframe src="${esc(osmUrl)}" title="${esc(p.label)}" loading="lazy" style="width:100%;height:320px;border:0;display:block;"></iframe><div style="display:flex;align-items:center;justify-content:space-between;padding:${space(3)} ${space(4)};background:var(--panel-bg, #FFFFFF);border-top:1px solid var(--panel-border, #E4E6C3);gap:12px;flex-wrap:wrap;"><div><strong style="display:block;font-size:0.95rem;color:var(--text);">${esc(p.label)}</strong>${p.address ? `<span style="font-size:0.85rem;color:var(--muted);">${esc(p.address)}</span>` : ""}</div><a href="${esc(dirUrl)}" target="_blank" rel="noopener noreferrer" class="ae-directions-btn" style="display:inline-flex;align-items:center;gap:${space(2)};padding:${space(2)} ${space(4)};border-radius:var(--radius-button, 8px);background:var(--accent);color:var(--accent-text, #5A6B24);font-weight:600;font-size:0.85rem;text-decoration:none;">${ICON_DIRECTIONS} Cómo llegar</a></div></figure>`;
  },
};

type ProductCardVariant = "standard" | "compact" | "featured";
const PRODUCT_CARD_VARIANTS = ["standard", "compact", "featured"] as const satisfies readonly ProductCardVariant[];

interface ProductCardProps {
  title: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  url: string;
  buttonLabel?: string;
  badge?: string;
  /** Forma. standard = el render historico. */
  variant?: ProductCardVariant;
}
const ProductCard: ElementDefinition<ProductCardProps> = {
  type: "ProductCard", displayName: "Ficha de producto (afiliado / propio)", icon: ICON_SHOPPING_CART,
  defaultProps: {
    title: "Micrófono Shure SM7B Vocal",
    description: "Micrófono profesional para estudio, voces y streaming. Patrón cardioide dinámico con rechazo electromagnético superior.",
    price: "$399 USD",
    imageUrl: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=600&q=80",
    url: "https://www.amazon.com/dp/B000SHZ56U",
    buttonLabel: "Comprar en Amazon",
    badge: "Afiliado",
    variant: "standard",
  },
  editableProps: [
    { key: "title", label: "Título del producto", kind: "text" },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "price", label: "Precio / Moneda", kind: "text" },
    { key: "imageUrl", label: "URL de la imagen", kind: "url" },
    { key: "url", label: "Enlace (afiliado o tienda)", kind: "url" },
    { key: "buttonLabel", label: "Texto del botón", kind: "text" },
    { key: "badge", label: "Etiqueta (opcional)", kind: "text" },
    { key: "variant", label: "Forma", kind: "select", options: [...PRODUCT_CARD_VARIANTS], optionLabels: {
      standard: "Vertical (la de siempre)",
      compact: "Horizontal, para listas",
      featured: "Imagen grande arriba",
    } },
  ],
  renderHTML: (p) => {
    const isExternal = /^https?:\/\//.test(String(p.url ?? ""));
    const linkAttrs = isExternal ? 'target="_blank" rel="sponsored noopener noreferrer"' : "";
    const variant = variantOf(p.variant, PRODUCT_CARD_VARIANTS, "standard");

    const image = p.imageUrl
      ? `<div style="position:relative;overflow:hidden;background:var(--bg, #F7F7F2);"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />${p.badge ? `<span style="position:absolute;top:${space(3)};left:${space(3)};background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);font-size:0.75rem;font-weight:700;padding:${space(1)} ${space(2)};border-radius:var(--radius-pill, 999px);border:1px solid var(--panel-border, #E4E6C3);box-shadow:var(--shadow-sm, 0 1px 2px rgba(0,0,0,.1));">${esc(p.badge)}</span>` : ""}</div>`
      : "";

    const action = `<a href="${esc(p.url)}" ${linkAttrs} style="display:block;width:100%;box-sizing:border-box;text-align:center;padding:${BUTTON_SIZES.md};border-radius:var(--radius-button, 8px);background:var(--accent, #C5D86D);color:#261C15;font-weight:700;text-decoration:none;font-size:0.95rem;">${esc(p.buttonLabel || "Ver producto")}</a>`;

    // compact: horizontal, para listas. Imagen a la izquierda y el texto a la
    // derecha; el alto lo marca la imagen, no un min-height inventado.
    if (variant === "compact") {
      return `<div class="ae-product-card" style="border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};overflow:hidden;background:var(--panel-bg, #FFFFFF);display:flex;flex-direction:row;align-items:stretch;">${image ? `<div style="flex:0 0 140px;aspect-ratio:1/1;overflow:hidden;background:var(--bg, #F7F7F2);"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" /></div>` : ""}<div style="padding:${space(4)};display:flex;flex-direction:column;gap:${space(2)};flex:1;min-width:0;"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:${space(2)};flex-wrap:wrap;"><h3 style="margin:0;font-size:1rem;color:var(--text);">${esc(p.title)}</h3>${p.price ? `<span style="font-weight:700;font-size:1rem;color:var(--accent-2, var(--accent, #F05D23));">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p style="margin:0;color:var(--muted);font-size:0.85rem;line-height:1.5;">${esc(p.description)}</p>` : ""}${p.badge ? `<span style="align-self:flex-start;font-size:0.7rem;font-weight:700;padding:${space(1)} ${space(2)};border-radius:var(--radius-pill, 999px);border:1px solid var(--panel-border, #E4E6C3);">${esc(p.badge)}</span>` : ""}<div style="margin-top:auto;padding-top:${space(2)};">${action}</div></div></div>`;
    }

    // featured: imagen grande arriba y titulo grande abajo. El thumbnail
    // responsive del catalogo Medusa es la imagen: no se cambia el src.
    if (variant === "featured") {
      return `<div class="ae-product-card" style="border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusPanel()};overflow:hidden;background:var(--panel-bg, #FFFFFF);display:flex;flex-direction:column;max-width:560px;margin:0 auto;box-shadow:var(--shadow-md, 0 4px 12px rgba(38,28,21,.08));">${image ? `<div style="position:relative;aspect-ratio:4/3;overflow:hidden;background:var(--bg, #F7F7F2);"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />${p.badge ? `<span style="position:absolute;top:${space(3)};left:${space(3)};background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);font-size:0.75rem;font-weight:700;padding:${space(1)} ${space(2)};border-radius:var(--radius-pill, 999px);border:1px solid var(--panel-border, #E4E6C3);box-shadow:var(--shadow-sm, 0 1px 2px rgba(0,0,0,.1));">${esc(p.badge)}</span>` : ""}</div>` : ""}<div style="padding:${space(5)};display:flex;flex-direction:column;gap:${space(3)};flex:1;"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:${space(2)};flex-wrap:wrap;"><h3 style="margin:0;font-size:1.4rem;color:var(--text);">${esc(p.title)}</h3>${p.price ? `<span style="font-weight:700;font-size:1.25rem;color:var(--accent-2, var(--accent, #F05D23));">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p style="margin:0;color:var(--muted);font-size:0.95rem;line-height:1.6;">${esc(p.description)}</p>` : ""}<div style="margin-top:auto;padding-top:${space(3)};">${action}</div></div></div>`;
    }

    // standard: el render historico byte a byte.
    return `<div class="ae-product-card" style="border:1px solid var(--panel-border, #E4E6C3);border-radius:${radiusCard()};overflow:hidden;background:var(--panel-bg, #FFFFFF);display:flex;flex-direction:column;max-width:480px;margin:0 auto;box-shadow:var(--shadow-sm, 0 1px 2px rgba(38,28,21,.06)), 0 1px 1px rgba(38,28,21,.04);">${p.imageUrl ? `<div style="position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--bg, #F7F7F2);"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />${p.badge ? `<span style="position:absolute;top:${space(3)};left:${space(3)};background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);font-size:0.75rem;font-weight:700;padding:${space(1)} ${space(2)};border-radius:var(--radius-pill, 999px);border:1px solid var(--panel-border, #E4E6C3);box-shadow:var(--shadow-sm, 0 1px 2px rgba(0,0,0,.06));">${esc(p.badge)}</span>` : ""}</div>` : ""}<div style="padding:${space(5)};display:flex;flex-direction:column;gap:${space(2)};flex:1;"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:${space(2)};flex-wrap:wrap;"><h3 style="margin:0;font-size:1.15rem;color:var(--text);">${esc(p.title)}</h3>${p.price ? `<span style="font-weight:700;font-size:1.1rem;color:var(--accent-2, var(--accent, #F05D23));">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p style="margin:0;color:var(--muted);font-size:0.9rem;line-height:1.5;">${esc(p.description)}</p>` : ""}<div style="margin-top:auto;padding-top:${space(2)};">${action}</div></div></div>`;
  },
};

export const elementRegistry: Record<ElementType, ElementDefinition<any>> = {
  Hero, Heading, Paragraph, Image: ImageEl, Button: ButtonEl, Columns, ProductGrid, Spacer,
  LinkList, SocialIcons, ProfileHeader, StoreBlock,
  Video, FAQ, Testimonial, Form: FormEl, Gallery,
  Map: MapEl, ProductCard,
};

export const elementPalette: ElementType[] = [
  "Hero", "Heading", "Paragraph", "Image", "Button", "Columns", "ProductGrid", "Spacer",
  "ProfileHeader", "LinkList", "SocialIcons", "StoreBlock",
  "Video", "FAQ", "Testimonial", "Form", "Gallery",
  "Map", "ProductCard",
];
