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

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

interface HeroProps { title: string; subtitle: string; bgColor: string; }
const Hero: ElementDefinition<HeroProps> = {
  type: "Hero", displayName: "Hero / Portada", icon: ICON_LAYOUT_TEMPLATE,
  defaultProps: { title: "Titulo principal", subtitle: "Subtitulo de apoyo", bgColor: "#261C15" },
  editableProps: [
    { key: "title", label: "Titulo", kind: "text" },
    { key: "subtitle", label: "Subtitulo", kind: "textarea" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  renderHTML: (p) => `<section style="background:${esc(p.bgColor)};padding:64px 32px;border-radius:20px;color:#fff;text-align:center;"><h1 style="font-size:2.2rem;margin:0 0 10px;">${esc(p.title)}</h1><p style="opacity:.85;margin:0;">${esc(p.subtitle)}</p></section>`,
};

interface HeadingProps { text: string; level: "h1" | "h2" | "h3"; align: "left" | "center" | "right"; }
const Heading: ElementDefinition<HeadingProps> = {
  type: "Heading", displayName: "Encabezado", icon: ICON_HEADING,
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
  renderHTML: (p) => `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="width:100%;border-radius:${esc(p.radius)}px;display:block;" loading="lazy" />`,
};

interface ButtonProps { label: string; href: string; style: "primary" | "secondary"; }
const ButtonEl: ElementDefinition<ButtonProps> = {
  type: "Button", displayName: "Boton", icon: ICON_MOUSE_POINTER_CLICK,
  defaultProps: { label: "Llamado a la accion", href: "#", style: "primary" },
  editableProps: [
    { key: "label", label: "Texto", kind: "text" },
    { key: "href", label: "Enlace", kind: "url" },
    { key: "style", label: "Estilo", kind: "select", options: ["primary", "secondary"] },
  ],
  renderHTML: (p) => {
    const bg = p.style === "primary" ? "var(--accent, #C5D86D)" : "transparent";
    const color = p.style === "primary" ? "#261C15" : "var(--accent-text, #5A6B24)";
    const border = p.style === "primary" ? "none" : "1px solid var(--accent, #C5D86D)";
    return `<a href="${esc(p.href)}" style="display:inline-block;padding:10px 22px;border-radius:var(--radius-button, 8px);background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;">${esc(p.label)}</a>`;
  },
};

interface ColumnsProps { count: 2 | 3; gap: number; }
const Columns: ElementDefinition<ColumnsProps> = {
  type: "Columns", displayName: "Columnas", icon: ICON_COLUMNS_2,
  defaultProps: { count: 2, gap: 16 },
  editableProps: [
    { key: "count", label: "Numero de columnas", kind: "select", options: ["2", "3"] },
    { key: "gap", label: "Espaciado", kind: "number" },
  ],
  renderHTML: (p, children = "") => `<div class="ae-columns" style="display:grid;grid-template-columns:repeat(${p.count},1fr);gap:${p.gap}px;align-items:start;">${children}</div>`,
};

interface ProductGridProps { source: "medusa" | "manual"; columns: number; limit: number; }
const ProductGrid: ElementDefinition<ProductGridProps> = {
  type: "ProductGrid", displayName: "Grilla de productos", icon: ICON_SHOPPING_CART,
  defaultProps: { source: "medusa", columns: 3, limit: 6 },
  editableProps: [
    { key: "source", label: "Origen de datos", kind: "select", options: ["medusa", "manual"] },
    { key: "columns", label: "Columnas", kind: "number" },
    { key: "limit", label: "Maximo de productos", kind: "number" },
  ],
  renderHTML: (p) => `<div class="ae-product-grid" data-source="${esc(p.source)}" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:12px;padding:20px;text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Vista previa del editor - el catalogo real de ${esc(p.source)} se carga en el build de produccion</div></div>`,
  renderHTMLAsync: async (p) => {
    if (p.source !== "medusa") {
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:12px;padding:20px;text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Origen "manual" seleccionado - agrega tus productos editando el JSON de la pagina.</div></div>`;
    }
    try {
      const { isCommerceEnabled, fetchProducts, formatPrice } = await import(/* @vite-ignore */ "../../../../src/commerce/medusa-client");
      const enabled = await isCommerceEnabled();
      if (!enabled) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:12px;padding:20px;text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Modulo de comercio desactivado. Define ENABLE_COMMERCE=true y src/commerce/config.ts para mostrar productos reales aqui.</div></div>`;
      }
      const products = (await fetchProducts()).slice(0, p.limit);
      if (products.length === 0) {
        return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;"><div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:12px;padding:20px;text-align:center;color:var(--muted, #6E6653);grid-column:1/-1;">Tu tienda Medusa/Mercur no tiene productos publicados todavia.</div></div>`;
      }
      const cards = products.map((product: any) => `<a href="/tienda/${esc(product.handle)}" style="display:block;border:1px solid var(--panel-border, #E4E6C3);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;">${product.thumbnail ? `<img src="${esc(product.thumbnail)}" alt="${esc(product.title)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" />` : ""}<div style="padding:12px;"><h4 style="margin:0 0 4px;font-size:14px;">${esc(product.title)}</h4><p style="margin:0;font-weight:700;color:var(--accent-text, #5A6B24);">${esc(formatPrice(product))}</p></div></a>`).join("");
      return `<div class="ae-product-grid" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;">${cards}</div>`;
    } catch (err) {
      return `<div class="ae-product-grid" style="border:1px dashed var(--danger-fg, #B3372C);border-radius:12px;padding:20px;text-align:center;color:var(--danger-fg, #B3372C);">Error cargando productos: ${esc((err as Error).message)}</div>`;
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
    { key: "buttonStyle", label: "Estilo de boton", kind: "select", options: ["solid", "outline"] },
  ],
  renderHTML: (p) => {
    const visible = p.links.filter((l) => l.enabled);
    const items = visible
      .map((l) => {
        const bg = p.buttonStyle === "solid" ? "var(--accent, #C5D86D)" : "transparent";
        const color = p.buttonStyle === "solid" ? "#261C15" : "var(--accent-text, #5A6B24)";
        const border = p.buttonStyle === "solid" ? "none" : "1px solid var(--accent, #C5D86D)";
        return `<a href="${esc(l.url)}" style="display:block;padding:14px 20px;border-radius:14px;background:${bg};color:${color};border:${border};font-weight:700;text-decoration:none;text-align:center;margin-bottom:10px;">${esc(l.label)}</a>`;
      })
      .join("");
    const heading = p.title ? `<h3 style="text-align:center;margin:0 0 16px;">${esc(p.title)}</h3>` : "";
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
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center", "right"] },
  ],
  renderHTML: (p) => {
    const icons = p.links
      .map(
        (l) =>
          `<a href="${esc(l.url)}" aria-label="${esc(l.platform)}" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);border:1px solid var(--panel-border, #E4E6C3);text-decoration:none;margin:0 6px;font-size:0.75rem;">${esc(l.platform.slice(0, 2).toUpperCase())}</a>`
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
  renderHTML: (p) => `<section style="background:${esc(p.bgColor)};padding:32px 24px;border-radius:20px;text-align:center;color:#fff;"><img src="${esc(p.avatarUrl)}" alt="${esc(p.name)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 12px;display:block;" loading="lazy" /><h2 style="margin:0 0 6px;font-size:1.3rem;">${esc(p.name)}</h2><p style="opacity:.85;margin:0;font-size:0.95rem;">${esc(p.bio)}</p></section>`,
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
    const radius = esc(p.radius);
    if (yt) {
      // enablejsapi=1: habilita los comandos postMessage del IFrame API
      // que el control de volumen del rincon del header (Atomic Icons
      // Responsive) envia para silenciar/des-silenciar. Sin el parametro
      // YouTube ignora los comandos. La clase ae-video es el selector
      // con que el listener localiza los players de la pagina.
      return `<figure class="ae-video" style="margin:0;position:relative;border-radius:${radius}px;overflow:hidden;aspect-ratio:16/9;background:var(--panel-border, #E4E6C3);"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt[1])}?enablejsapi=1" title="${esc(p.title)}" loading="lazy" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe></figure>`;
    }
    if (vimeo) {
      return `<figure class="ae-video" style="margin:0;position:relative;border-radius:${radius}px;overflow:hidden;aspect-ratio:16/9;background:var(--panel-border, #E4E6C3);"><iframe src="https://player.vimeo.com/video/${esc(vimeo[1])}" title="${esc(p.title)}" loading="lazy" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe></figure>`;
    }
    return `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${radius}px;padding:32px;text-align:center;color:var(--muted, #6E6653);">URL no reconocida - pega un enlace de YouTube (youtube.com/watch, youtu.be o shorts) o Vimeo (vimeo.com).</div>`;
  },
};

interface FAQProps { title: string; items: string; }
const FAQ: ElementDefinition<FAQProps> = {
  type: "FAQ", displayName: "Preguntas frecuentes", icon: ICON_CIRCLE_QUESTION_MARK,
  defaultProps: {
    title: "Preguntas frecuentes",
    items: "¿Cuanto tarda el envio? :: Entre 2 y 5 dias habiles.\n¿Puedo devolver el producto? :: Si, tenes 30 dias.",
  },
  editableProps: [
    { key: "title", label: "Titulo de la seccion", kind: "text" },
    { key: "items", label: "Preguntas (una por linea: Pregunta :: Respuesta)", kind: "textarea" },
  ],
  renderHTML: (p) => {
    const items = String(p.items ?? "")
      .split("\n")
      .map((line) => line.split("::"))
      .filter((parts) => (parts[0] ?? "").trim())
      .map(
        ([q, ...rest]) =>
          `<details style="border:1px solid var(--panel-border, #E4E6C3);border-radius:12px;margin-bottom:10px;background:var(--panel-bg, #FFFFFF);"><summary style="padding:14px 18px;cursor:pointer;font-weight:700;">${esc(q.trim())}</summary><div style="padding:0 18px 14px;line-height:1.6;color:var(--muted, #6E6653);">${esc(rest.join("::").trim())}</div></details>`
      )
      .join("");
    const heading = p.title ? `<h3 style="margin:0 0 16px;">${esc(p.title)}</h3>` : "";
    return `<section style="margin:0;">${heading}${items || `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:12px;padding:24px;text-align:center;color:var(--muted, #6E6653);">Agrega preguntas en el panel: una por linea con el formato \"Pregunta :: Respuesta\".</div>`}</section>`;
  },
};

interface TestimonialProps { quote: string; author: string; role: string; avatarUrl: string; align: "left" | "center"; }
const Testimonial: ElementDefinition<TestimonialProps> = {
  type: "Testimonial", displayName: "Testimonio", icon: ICON_MESSAGE_SQUARE_QUOTE,
  defaultProps: {
    quote: "Trabajar con este equipo cambio la manera en que publicamos. Recomendado.",
    author: "Nombre del cliente",
    role: "Rol o empresa",
    avatarUrl: "https://placehold.co/96x96",
    align: "center",
  },
  editableProps: [
    { key: "quote", label: "Cita", kind: "textarea" },
    { key: "author", label: "Autor", kind: "text" },
    { key: "role", label: "Rol o empresa", kind: "text" },
    { key: "avatarUrl", label: "URL del avatar", kind: "url" },
    { key: "align", label: "Alineacion", kind: "select", options: ["left", "center"] },
  ],
  renderHTML: (p) => {
    const avatar = p.avatarUrl
      ? `<img src="${esc(p.avatarUrl)}" alt="${esc(p.author)}" width="48" height="48" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-bottom:12px;display:block;${p.align === "center" ? "margin-left:auto;margin-right:auto;" : ""}" loading="lazy" />`
      : "";
    const authorLine = p.author
      ? `<figcaption style="font-weight:700;">${esc(p.author)}${p.role ? `<span style="display:block;font-weight:400;color:var(--muted, #6E6653);font-size:.85rem;">${esc(p.role)}</span>` : ""}</figcaption>`
      : "";
    return `<figure style="margin:0;text-align:${esc(p.align)};border:1px solid var(--panel-border, #E4E6C3);border-radius:16px;padding:24px;background:var(--panel-bg, #FFFFFF);">${avatar}<blockquote style="margin:0 0 14px;line-height:1.6;">${esc(p.quote)}</blockquote>${authorLine}</figure>`;
  },
};

interface FormProps { action: string; submitLabel: string; anchorId: string; }
const FormEl: ElementDefinition<FormProps> = {
  type: "Form", displayName: "Formulario de contacto", icon: ICON_MAIL,
  defaultProps: { action: "", submitLabel: "Enviar mensaje", anchorId: "contacto" },
  editableProps: [
    { key: "action", label: "Endpoint (URL de Formspree, Basin, etc.)", kind: "url" },
    { key: "submitLabel", label: "Texto del boton", kind: "text" },
    { key: "anchorId", label: "Ancla (para botones #...)", kind: "text" },
  ],
  renderHTML: (p) => {
    const anchor = p.anchorId ? ` id="${esc(p.anchorId)}"` : "";
    const fieldStyle = "width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid var(--panel-border, #E4E6C3);border-radius:var(--radius-input, 6px);font:inherit;background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);margin-bottom:10px;";
    const label = (text: string, inner: string) => `<label style="display:block;font-weight:700;font-size:.85rem;margin-bottom:4px;">${text}${inner}</label>`;
    if (!String(p.action ?? "").trim()) {
      return `<div${anchor} style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:16px;padding:24px;text-align:center;color:var(--muted, #6E6653);">Este formulario todavia no entrega a ningun destino. Configura un endpoint (por ejemplo Formspree o Basin, ambos con plan gratuito) en la propiedad \"Endpoint\" y el formulario empezara a enviar mensajes reales.</div>`;
    }
    return `<form${anchor} method="post" action="${esc(p.action)}" style="display:flex;flex-direction:column;border:1px solid var(--panel-border, #E4E6C3);border-radius:16px;padding:24px;background:var(--panel-bg, #FFFFFF);">${label("Nombre", `<input type="text" name="nombre" required style="${fieldStyle}" />`)}${label("Email", `<input type="email" name="email" required style="${fieldStyle}" />`)}${label("Mensaje", `<textarea name="mensaje" rows="5" required style="${fieldStyle}resize:vertical;"></textarea>`)}<button type="submit" style="align-self:flex-start;padding:10px 22px;border-radius:var(--radius-button, 8px);border:none;background:var(--accent, #C5D86D);color:#261C15;font-weight:700;cursor:pointer;">${esc(p.submitLabel)}</button></form>`;
  },
};

interface GalleryProps { images: string; columns: 2 | 3 | 4; radius: number; }
const Gallery: ElementDefinition<GalleryProps> = {
  type: "Gallery", displayName: "Galeria", icon: ICON_IMAGES,
  defaultProps: {
    images: "https://placehold.co/600x600\nhttps://placehold.co/600x600/C5D86D\nhttps://placehold.co/600x600/261C15",
    columns: 3,
    radius: 12,
  },
  editableProps: [
    { key: "images", label: "Imagenes (una URL por linea)", kind: "textarea" },
    { key: "columns", label: "Columnas", kind: "select", options: ["2", "3", "4"] },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) => {
    const urls = String(p.images ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//.test(line) || line.startsWith("/"));
    if (urls.length === 0) {
      return `<div style="border:1px dashed var(--panel-border, #E4E6C3);border-radius:${esc(p.radius)}px;padding:24px;text-align:center;color:var(--muted, #6E6653);">Agrega imagenes en el panel: una URL por linea.</div>`;
    }
    const cells = urls
      .map((url) => {
        const alt = decodeURIComponent(url.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_+]/g, " ") || "Imagen de la galeria";
        return `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:block;border-radius:${esc(p.radius)}px;overflow:hidden;"><img src="${esc(url)}" alt="${esc(alt)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" /></a>`;
      })
      .join("");
    return `<div class="ae-gallery" style="display:grid;grid-template-columns:repeat(${esc(p.columns)},1fr);gap:12px;">${cells}</div>`;
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
    const radius = Number(p.radius ?? 16);
    return `<figure id="ae-map" class="ae-map" style="margin:0;position:relative;border-radius:${radius}px;overflow:hidden;border:1px solid var(--panel-border, #E4E6C3);background:var(--panel-bg, #FFFFFF);"><iframe src="${esc(osmUrl)}" title="${esc(p.label)}" loading="lazy" style="width:100%;height:320px;border:0;display:block;"></iframe><div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--panel-bg, #FFFFFF);border-top:1px solid var(--panel-border, #E4E6C3);gap:12px;flex-wrap:wrap;"><div><strong style="display:block;font-size:0.95rem;color:var(--text);">${esc(p.label)}</strong>${p.address ? `<span style="font-size:0.85rem;color:var(--muted);">${esc(p.address)}</span>` : ""}</div><a href="${esc(dirUrl)}" target="_blank" rel="noopener noreferrer" class="ae-directions-btn" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:var(--radius-button, 8px);background:var(--accent);color:var(--accent-text, #5A6B24);font-weight:600;font-size:0.85rem;text-decoration:none;">${ICON_DIRECTIONS} Cómo llegar</a></div></figure>`;
  },
};

interface ProductCardProps {
  title: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  url: string;
  buttonLabel?: string;
  badge?: string;
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
  },
  editableProps: [
    { key: "title", label: "Título del producto", kind: "text" },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "price", label: "Precio / Moneda", kind: "text" },
    { key: "imageUrl", label: "URL de la imagen", kind: "url" },
    { key: "url", label: "Enlace (afiliado o tienda)", kind: "url" },
    { key: "buttonLabel", label: "Texto del botón", kind: "text" },
    { key: "badge", label: "Etiqueta (opcional)", kind: "text" },
  ],
  renderHTML: (p) => {
    const isExternal = /^https?:\/\//.test(String(p.url ?? ""));
    const linkAttrs = isExternal ? 'target="_blank" rel="sponsored noopener noreferrer"' : "";
    return `<div class="ae-product-card" style="border:1px solid var(--panel-border, #E4E6C3);border-radius:18px;overflow:hidden;background:var(--panel-bg, #FFFFFF);display:flex;flex-direction:column;max-width:480px;margin:0 auto;box-shadow:var(--shadow-sm, 0 2px 8px rgba(38,28,21,.08));">${p.imageUrl ? `<div style="position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--bg, #F7F7F2);"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />${p.badge ? `<span style="position:absolute;top:12px;left:12px;background:var(--panel-bg, #FFFFFF);color:var(--text, #261C15);font-size:0.75rem;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--panel-border, #E4E6C3);box-shadow:0 2px 6px rgba(0,0,0,.1);">${esc(p.badge)}</span>` : ""}</div>` : ""}<div style="padding:20px;display:flex;flex-direction:column;gap:10px;flex:1;"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;"><h3 style="margin:0;font-size:1.15rem;color:var(--text);">${esc(p.title)}</h3>${p.price ? `<span style="font-weight:700;font-size:1.1rem;color:var(--accent-2, var(--accent, #F05D23));">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p style="margin:0;color:var(--muted);font-size:0.9rem;line-height:1.5;">${esc(p.description)}</p>` : ""}<div style="margin-top:auto;padding-top:8px;"><a href="${esc(p.url)}" ${linkAttrs} style="display:block;width:100%;box-sizing:border-box;text-align:center;padding:12px 18px;border-radius:var(--radius-button, 8px);background:var(--accent, #C5D86D);color:#261C15;font-weight:700;text-decoration:none;font-size:0.95rem;">${esc(p.buttonLabel || "Ver producto")}</a></div></div></div>`;
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
