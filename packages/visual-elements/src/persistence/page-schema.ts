// Validacion minima del formato de pagina antes de guardarlo o renderizarlo.
// Evita que un layout corrupto (por ejemplo, tras un bug del editor) llegue
// al motor de render y rompa el build estatico completo del sitio.
//
// v0.0.9.11: acepta un catalogo resuelto OPCIONAL (core ∪ element packs).
// Sin catalogo valida contra el core, igual que siempre (retro-compatible).
// Con catalogo, un tipo contribuido por un pack (ej. "demo.Badge") pasa la
// validacion -- ver docs/architecture/element-catalog-plugins.md.

import type { PageLayout, ElementNode } from "../types";
import { elementRegistry, COLUMNS_RATIOS, FEATURE_GRID_LAYOUTS } from "../elements/registry";
import type { ResolvedCatalog } from "../elements/element-pack";
import { THEME_NAME_PATTERN } from "../themes/theme-pack";

const COLUMNS_RATIO_SET = new Set<string>(COLUMNS_RATIOS);
const FEATURE_GRID_LAYOUT_SET = new Set<string>(FEATURE_GRID_LAYOUTS);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateNode(
  node: ElementNode,
  path: string,
  errors: string[],
  hasType: (type: string) => boolean
): void {
  if (!hasType(node.type)) {
    errors.push(`${path}: tipo de elemento desconocido "${node.type}"`);
    return;
  }
  if (!node.id) {
    errors.push(`${path}: falta "id" en el nodo`);
  }
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (node.type === "Columns" && props.ratio !== undefined) {
    if (typeof props.ratio !== "string" || !COLUMNS_RATIO_SET.has(props.ratio)) {
      errors.push(`${path}: "ratio" invalido en Columns (${JSON.stringify(props.ratio)}); permitidos: ${COLUMNS_RATIOS.join(", ")}`);
    }
  }
  if (node.type === "FeatureGrid") {
    if (props.layout !== undefined && (typeof props.layout !== "string" || !FEATURE_GRID_LAYOUT_SET.has(props.layout))) {
      errors.push(`${path}: "layout" invalido en FeatureGrid (${JSON.stringify(props.layout)}); permitidos: ${FEATURE_GRID_LAYOUTS.join(", ")}`);
    }
    if (Array.isArray(props.items)) {
      props.items.forEach((item, idx) => {
        if (item && typeof item === "object" && "span" in item && (item as Record<string, unknown>).span !== undefined) {
          const sp = (item as Record<string, unknown>).span;
          if (sp !== 1 && sp !== 2) {
            errors.push(`${path}.props.items[${idx}]: "span" debe ser 1 o 2 (recibido: ${JSON.stringify(sp)})`);
          }
        }
      });
    }
  }
  node.children?.forEach((child, i) => validateNode(child, `${path}.children[${i}]`, errors, hasType));
}

export function validatePageLayout(
  layout: PageLayout,
  catalog?: ResolvedCatalog
): ValidationResult {
  const errors: string[] = [];
  const coreTypes = new Set<string>(Object.keys(elementRegistry));
  const hasType = catalog
    ? (t: string) => catalog.has(t)
    : (t: string) => coreTypes.has(t);

  if (layout.version !== "0.1") errors.push(`Versión de esquema no soportada: ${layout.version}`);
  // layoutVersion: contrato de datos del CONTENIDO. Solo se valida el FORMATO;
  // una version mayor a la conocida no es error (el render usa el fallback
  // seguro, igual que un tema desconocido), pero si un valor invalido.
  if (layout.layoutVersion !== undefined && (!Number.isInteger(layout.layoutVersion) || layout.layoutVersion < 1)) {
    errors.push(`"layoutVersion" debe ser un entero >= 1 (recibido: ${JSON.stringify(layout.layoutVersion)}).`);
  }
  if (!layout.slug) errors.push('Falta "slug" en la página.');
  if (!Array.isArray(layout.root)) errors.push('"root" debe ser un arreglo de elementos.');
  if (layout.status !== undefined && layout.status !== "draft" && layout.status !== "published" && layout.status !== "private") {
    errors.push(`"status" debe ser "draft", "published" o "private" (recibido: ${JSON.stringify(layout.status)}).`);
  }
  // v0.0.9.11: tema por pagina. Solo se valida el FORMATO (slug); el
  // membership contra el catalogo lo hace apply_theme al escribir, porque
  // aqui no hay catalogo a mano y un tema desconocido cae honradamente al
  // skin del sitio en el render (fallback, nunca crash).
  if (layout.theme !== undefined && (typeof layout.theme !== "string" || !THEME_NAME_PATTERN.test(layout.theme))) {
    errors.push(`"theme" debe ser un nombre de tema (slug): recibido ${JSON.stringify(layout.theme)}.`);
  }
  if (layout.alternateLang !== undefined) {
    const alt = layout.alternateLang as unknown;
    if (!alt || typeof alt !== "object" || Array.isArray(alt)) {
      errors.push('"alternateLang" debe ser un objeto { code, href }.');
    } else {
      const { code, href } = alt as Record<string, unknown>;
      const validCode = typeof code === "string" && (/^[a-zA-Z]{2,5}$/.test(code) || /^[a-zA-Z]{2}-[a-zA-Z]{2}$/.test(code));
      if (!validCode) {
        errors.push(`"alternateLang.code" debe ser un código de idioma de 2 a 5 caracteres (recibido: ${JSON.stringify(code)}).`);
      }
      const validHref =
        typeof href === "string" &&
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !/javascript:/i.test(href) &&
        !/[\s<>"']/.test(href);
      if (!validHref) {
        errors.push(`"alternateLang.href" debe ser una ruta relativa segura que empiece por "/" (recibido: ${JSON.stringify(href)}).`);
      }
    }
  }

  layout.root?.forEach((node, i) => validateNode(node, `root[${i}]`, errors, hasType));

  return { valid: errors.length === 0, errors };
}
