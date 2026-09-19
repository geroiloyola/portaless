import type { ElementDefinition, ElementType } from "../types";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

interface HeroProps { title: string; subtitle: string; bgColor: string; }
const Hero: ElementDefinition<HeroProps> = {
  type: "Hero", displayName: "Hero / Portada", icon: "🏔️",
  defaultProps: { title: "Titulo principal", subtitle: "Subtitulo de apoyo", bgColor: "#111827" },
  editableProps: [
    { key: "title", label: "Titulo", kind: "text" },
    { key: "subtitle", label: "Subtitulo", kind: "textarea" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  renderHTML: (p) => `<section style="background:${esc(p.bgColor)};padding:64px 32px;border-radius:20px;color:#fff;text-align:center;"><h1 style="font-size:2.2rem;margin:0 0 10px;">${esc(p.title)}</h1><p style="opacity:.85;margin:0;">${esc(p.subtitle)}</p></section>`,
};

interface HeadingProps { text: string; level: "h1" | "h2" | "h3"; align: "left" | "center" | "right"; }
const Heading: ElementDefinition<HeadingProps> = {
  type: "Heading", displayName: "Encabezado", icon: "🔠",
  defaultProps: { text: "Encabezado de seccion", level: "h2", align: "left" },
  editableProps: [
    { key: "text", label: "Texto", kind: "text" },
    { key: "level", label: "Nivel", kind: "select", options: ["h1", "h2", "h3"] },
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center", "right"] },
  ],
  renderHTML: (p) => `<${p.level} style="text-align:${p.align};margin:0;">${esc(p.text)}</${p.level}>`,
};

interface ParagraphProps { text: string; }
const Paragraph: ElementDefinition<ParagraphProps> = {
  type: "Paragraph", displayName: "Parrafo", icon: "📝",
  defaultProps: { text: "Escribe aqui el contenido de este parrafo." },
  editableProps: [{ key: "text", label: "Texto", kind: "textarea" }],
  renderHTML: (p) => `<p style="line-height:1.6;margin:0;">${esc(p.text)}</p>`,
};

interface ImageProps { src: string; alt: string; radius: number; }
const ImageEl: ElementDefinition<ImageProps> = {
  type: "Image", displayName: "Imagen", icon: "🖼️",
  defaultProps: { src: "https://placehold.co/800x400", alt: "Descripcion de la imagen", radius: 16 },
  editableProps: [
    { key: "src", label: "URL de la imagen", kind: "url" },
    { key: "alt", label: "Texto alternativo", kind: "text" },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) => `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="width:100%;border-radius:${esc(p.radius)}px;display:block;" loading="lazy" />`,
};

interface ButtonProps { label: string; href: string; style: "primary" | "secondary"; }
const ButtonEl: ElementDefinition<ButtonProps> = {
  type: "Button", displayName: "Boton", icon: "🔘",
  defaultProps: { label: "Llamado a la accion", href: "#", style: "primary" },
  editableProps: [
    { key: "label", label: "Texto", kind: "text" },
    { key: "href", label: "Enlace", kind: "url" },
    { key: "style", label: "Estilo", kind: "select", options: ["primary", "secondary"] },
  ],
  renderHTML: (p) => {
    const bg = p.style === "primary" ? "#6ee7b7" : "transparent";
    const color = p.style === "primary" ? "#0a0b0f" : "#6ee7b7";
    const border = p.style === "primary" ? "none" : "1px solid #6ee7b7";
    return `<a href="${esc(p.href)}" style="display:inline-block;padding:10px 22px;border-radius:999px;background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;">${esc(p.label)}</a>`;
  },
};

interface ColumnsProps { count: 2 | 3; gap: number; }
const Columns: ElementDefinition<ColumnsProps> = {
  type: "Columns", displayName: "Columnas", icon: "▥",
  defaultProps: { count: 2, gap: 16 },
  editableProps: [
    { key: "count", label: "Numero de columnas", kind: "select", options: ["2", "3"] },
    { key: "gap", label: "Espaciado", kind: "number" },
  ],
  renderHTML: (p, children = "") => `<div class="ae-columns" style="display:grid;grid-template-columns:repeat(${p.count},1fr);gap:${p.gap}px;align-items:start;">${children}</div>`,
};

interface ProductGridProps { source: "medusa" | "manual"; columns: number; limit: number; }
const ProductGrid: ElementDefinition<ProductGridProps> = {
  type: "ProductGrid", displayName: "Grilla de productos", icon: "🛒",
  defaultProps: { source: "medusa", columns: 3, limit: 6 },
  editableProps: [
    { key: "source", label: "Origen de datos", kind: "select", options: ["medusa", "manual"] },
    { key: "columns", label: "Columnas", kind: "number" },
    { key: "limit", label: "Maximo de productos", kind: "number" },
  ],
  renderHTML: (p) => `<div class="ae-product-grid" data-source="${esc(p.source)}" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed #444;border-radius:12px;padding:20px;text-align:center;color:#888;grid-column:1/-1;">Vista previa del editor - el catalogo real de ${esc(p.source)} se carga en el build de produccion</div></div>`,
  renderHTMLAsync: async (p) => {
    if (p.source !== "medusa") {
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed #444;border-radius:12px;padding:20px;text-align:center;color:#888;grid-column:1/-1;">Origen "manual" seleccionado - agrega tus productos editando el JSON de la pagina.</div></div>`;
    }
    try {
      const { isCommerceEnabled, fetchProducts, formatPrice } = await import(/* @vite-ignore */ "../../../../src/commerce/medusa-client");
      const enabled = await isCommerceEnabled();
      if (!enabled) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed #444;border-radius:12px;padding:20px;text-align:center;color:#888;grid-column:1/-1;">Modulo de comercio desactivado. Define ENABLE_COMMERCE=true y src/commerce/config.ts para mostrar productos reales aqui.</div></div>`;
      }
      const products = (await fetchProducts()).slice(0, p.limit);
      if (products.length === 0) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed #444;border-radius:12px;padding:20px;text-align:center;color:#888;grid-column:1/-1;">Tu tienda Medusa/Mercur no tiene productos publicados todavia.</div></div>`;
      }
      const cards = products.map((product: any) => `<a href="/tienda/${esc(product.handle)}" style="display:block;border:1px solid #262b38;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;">${product.thumbnail ? `<img src="${esc(product.thumbnail)}" alt="${esc(product.title)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" />` : ""}<div style="padding:12px;"><h4 style="margin:0 0 4px;font-size:14px;">${esc(product.title)}</h4><p style="margin:0;font-weight:700;color:#6ee7b7;">${esc(formatPrice(product))}</p></div></a>`).join("");
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;">${cards}</div>`;
    } catch (err) {
      return `<div class="ae-product-grid" style="border:1px dashed #ff6e6e;border-radius:12px;padding:20px;text-align:center;color:#ff8f8f;">Error cargando productos: ${esc((err as Error).message)}</div>`;
    }
  },
};

interface SpacerProps { height: number; }
const Spacer: ElementDefinition<SpacerProps> = {
  type: "Spacer", displayName: "Espaciador", icon: "↕️",
  defaultProps: { height: 32 },
  editableProps: [{ key: "height", label: "Altura (px)", kind: "number" }],
  renderHTML: (p) => `<div style="height:${esc(p.height)}px;"></div>`,
};

interface LinkItem { label: string; url: string; icon?: string; enabled: boolean; }
interface LinkListProps { title: string; links: LinkItem[]; buttonStyle: "solid" | "outline"; }
const LinkList: ElementDefinition<LinkListProps> = {
  type: "LinkList", displayName: "Lista de enlaces", icon: "🔗",
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
    { key: "buttonStyle", label: "Estilo de boton", kind: "select", options: ["solid", "outline"] },
  ],
  renderHTML: (p) => {
    const visible = p.links.filter((l) => l.enabled);
    const items = visible
      .map((l) => {
        const bg = p.buttonStyle === "solid" ? "#6ee7b7" : "transparent";
        const color = p.buttonStyle === "solid" ? "#0a0b0f" : "#6ee7b7";
        const border = p.buttonStyle === "solid" ? "none" : "1px solid #6ee7b7";
        return `<a href="${esc(l.url)}" style="display:block;padding:14px 20px;border-radius:14px;background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;text-align:center;margin-bottom:10px;">${esc(l.label)}</a>`;
      })
      .join("");
    const heading = p.title ? `<h3 style="text-align:center;margin:0 0 16px;">${esc(p.title)}</h3>` : "";
    return `<div class="ae-link-list" style="max-width:480px;margin:0 auto;">${heading}${items}</div>`;
  },
};

interface SocialIconsProps { links: Array<{ platform: string; url: string }>; align: "left" | "center" | "right"; }
const SocialIcons: ElementDefinition<SocialIconsProps> = {
  type: "SocialIcons", displayName: "Iconos sociales", icon: "🌐",
  defaultProps: {
    links: [
      { platform: "instagram", url: "https://instagram.com/" },
      { platform: "tiktok", url: "https://tiktok.com/@" },
    ],
    align: "center",
  },
  editableProps: [
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center", "right"] },
  ],
  renderHTML: (p) => {
    const icons = p.links
      .map(
        (l) =>
          `<a href="${esc(l.url)}" aria-label="${esc(l.platform)}" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:#1c2029;color:#fff;text-decoration:none;margin:0 6px;font-size:0.75rem;">${esc(l.platform.slice(0, 2).toUpperCase())}</a>`
      )
      .join("");
    return `<div class="ae-social-icons" style="text-align:${p.align};">${icons}</div>`;
  },
};

interface ProfileHeaderProps { avatarUrl: string; name: string; bio: string; bgColor: string; }
const ProfileHeader: ElementDefinition<ProfileHeaderProps> = {
  type: "ProfileHeader", displayName: "Perfil / Bio", icon: "🧑",
  defaultProps: {
    avatarUrl: "https://placehold.co/160x160",
    name: "Tu nombre",
    bio: "Una linea corta sobre ti o tu marca.",
    bgColor: "#111827",
  },
  editableProps: [
    { key: "avatarUrl", label: "URL del avatar", kind: "url" },
    { key: "name", label: "Nombre", kind: "text" },
    { key: "bio", label: "Bio corta", kind: "textarea" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  renderHTML: (p) => `<section style="background:${esc(p.bgColor)};padding:32px 24px;border-radius:20px;text-align:center;color:#fff;"><img src="${esc(p.avatarUrl)}" alt="${esc(p.name)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 12px;display:block;" loading="lazy" /><h2 style="margin:0 0 6px;font-size:1.3rem;">${esc(p.name)}</h2><p style="opacity:.85;margin:0;font-size:0.95rem;">${esc(p.bio)}</p></section>`,
};

interface StoreBlockProps { columns: number; limit: number; }
const StoreBlock: ElementDefinition<StoreBlockProps> = {
  type: "StoreBlock", displayName: "Tienda de afiliados", icon: "🛍️",
  defaultProps: { columns: 2, limit: 6 },
  editableProps: [
    { key: "columns", label: "Columnas", kind: "number" },
    { key: "limit", label: "Maximo de productos", kind: "number" },
  ],
  renderHTML: (p) =>
    ProductGrid.renderHTML({ source: "manual", columns: p.columns, limit: p.limit }),
};

export const elementRegistry: Record<ElementType, ElementDefinition<any>> = {
  Hero, Heading, Paragraph, Image: ImageEl, Button: ButtonEl, Columns, ProductGrid, Spacer,
  LinkList, SocialIcons, ProfileHeader, StoreBlock,
};

export const elementPalette: ElementType[] = [
  "Hero", "Heading", "Paragraph", "Image", "Button", "Columns", "ProductGrid", "Spacer",
  "ProfileHeader", "LinkList", "SocialIcons", "StoreBlock",
];
