// Catalogo fijo de elementos de pagina. Atomic Elements NUNCA genera HTML
// arbitrario desde el editor -- todo layout se compone unicamente
// referenciando estos elementos por "type", igual que un skin de dashboard
// solo referencia organismos por nombre.
//
// Cada renderHTML() devuelve UN nodo raiz (o los minimos indispensables),
// nunca los 15-20 niveles de <div> anidados que generan los builders
// tradicionales -- ver docs/ATOMIC_ELEMENTS.md.

import type { ElementDefinition, ElementType } from "../types";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

interface HeroProps { title: string; subtitle: string; bgColor: string; }
const Hero: ElementDefinition<HeroProps> = {
  type: "Hero",
  displayName: "Hero / Portada",
  icon: "🏔️",
  defaultProps: { title: "Título principal", subtitle: "Subtítulo de apoyo", bgColor: "#111827" },
  editableProps: [
    { key: "title", label: "Título", kind: "text" },
    { key: "subtitle", label: "Subtítulo", kind: "textarea" },
    { key: "bgColor", label: "Color de fondo", kind: "color" },
  ],
  renderHTML: (p) =>
    `<section class="ae-hero" style="background:${esc(p.bgColor)};padding:64px 32px;border-radius:20px;color:#fff;text-align:center;">
       <h1 style="font-size:2.2rem;margin:0 0 10px;">${esc(p.title)}</h1>
       <p style="opacity:.85;margin:0;">${esc(p.subtitle)}</p>
     </section>`,
};

interface HeadingProps { text: string; level: "h1" | "h2" | "h3"; align: "left" | "center" | "right"; }
const Heading: ElementDefinition<HeadingProps> = {
  type: "Heading",
  displayName: "Encabezado",
  icon: "🔠",
  defaultProps: { text: "Encabezado de sección", level: "h2", align: "left" },
  editableProps: [
    { key: "text", label: "Texto", kind: "text" },
    { key: "level", label: "Nivel", kind: "select", options: ["h1", "h2", "h3"] },
    { key: "align", label: "Alineación", kind: "select", options: ["left", "center", "right"] },
  ],
  renderHTML: (p) => `<${p.level} style="text-align:${p.align};margin:0;">${esc(p.text)}</${p.level}>`,
};

interface ParagraphProps { text: string; }
const Paragraph: ElementDefinition<ParagraphProps> = {
  type: "Paragraph",
  displayName: "Párrafo",
  icon: "📝",
  defaultProps: { text: "Escribe aquí el contenido de este párrafo." },
  editableProps: [{ key: "text", label: "Texto", kind: "textarea" }],
  renderHTML: (p) => `<p style="line-height:1.6;margin:0;">${esc(p.text)}</p>`,
};

interface ImageProps { src: string; alt: string; radius: number; }
const ImageEl: ElementDefinition<ImageProps> = {
  type: "Image",
  displayName: "Imagen",
  icon: "🖼️",
  defaultProps: { src: "https://placehold.co/800x400", alt: "Descripción de la imagen", radius: 16 },
  editableProps: [
    { key: "src", label: "URL de la imagen", kind: "url" },
    { key: "alt", label: "Texto alternativo", kind: "text" },
    { key: "radius", label: "Radio de borde", kind: "number" },
  ],
  renderHTML: (p) =>
    `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="width:100%;border-radius:${esc(p.radius)}px;display:block;" loading="lazy" />`,
};

interface ButtonProps { label: string; href: string; style: "primary" | "secondary"; }
const ButtonEl: ElementDefinition<ButtonProps> = {
  type: "Button",
  displayName: "Botón",
  icon: "🔘",
  defaultProps: { label: "Llamado a la acción", href: "#", style: "primary" },
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
  type: "Columns",
  displayName: "Columnas",
  icon: "▥",
  defaultProps: { count: 2, gap: 16 },
  editableProps: [
    { key: "count", label: "Número de columnas", kind: "select", options: ["2", "3"] },
    { key: "gap", label: "Espaciado", kind: "number" },
  ],
  renderHTML: (p, children = "") =>
    `<div style="display:grid;grid-template-columns:repeat(${p.count},1fr);gap:${p.gap}px;">${children}</div>`,
};

interface ProductGridProps { source: "medusa" | "manual"; columns: number; }
const ProductGrid: ElementDefinition<ProductGridProps> = {
  type: "ProductGrid",
  displayName: "Grilla de productos",
  icon: "🛒",
  defaultProps: { source: "medusa", columns: 3 },
  editableProps: [
    { key: "source", label: "Origen de datos", kind: "select", options: ["medusa", "manual"] },
    { key: "columns", label: "Columnas", kind: "number" },
  ],
  renderHTML: (p) =>
    `<div class="ae-product-grid" data-source="${esc(p.source)}" style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:16px;">
       <!-- Portaless llena este bloque en build/runtime desde el módulo de comercio (Medusa/Mercur) -->
       <div style="border:1px dashed #444;border-radius:12px;padding:20px;text-align:center;color:#888;">
         Productos se cargan desde ${esc(p.source)} en tiempo de build
       </div>
     </div>`,
};

interface SpacerProps { height: number; }
const Spacer: ElementDefinition<SpacerProps> = {
  type: "Spacer",
  displayName: "Espaciador",
  icon: "↕️",
  defaultProps: { height: 32 },
  editableProps: [{ key: "height", label: "Altura (px)", kind: "number" }],
  renderHTML: (p) => `<div style="height:${esc(p.height)}px;"></div>`,
};

export const elementRegistry: Record<ElementType, ElementDefinition<any>> = {
  Hero,
  Heading,
  Paragraph,
  Image: ImageEl,
  Button: ButtonEl,
  Columns,
  ProductGrid,
  Spacer,
};

export const elementPalette: ElementType[] = [
  "Hero", "Heading", "Paragraph", "Image", "Button", "Columns", "ProductGrid", "Spacer",
];
