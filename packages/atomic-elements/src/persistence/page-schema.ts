// Validacion minima del formato de pagina antes de guardarlo o renderizarlo.
// Evita que un layout corrupto (por ejemplo, tras un bug del editor) llegue
// al motor de render y rompa el build estatico completo del sitio.
//
// v0.0.9.11: acepta un catalogo resuelto OPCIONAL (core ∪ element packs).
// Sin catalogo valida contra el core, igual que siempre (retro-compatible).
// Con catalogo, un tipo contribuido por un pack (ej. "demo.Badge") pasa la
// validacion -- ver docs/architecture/element-catalog-plugins.md.

import type { PageLayout, ElementNode } from "../types";
import { elementRegistry } from "../elements/registry";
import type { ResolvedCatalog } from "../elements/element-pack";
import { THEME_NAME_PATTERN } from "../themes/theme-pack";

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
  if (!layout.slug) errors.push('Falta "slug" en la página.');
  if (!Array.isArray(layout.root)) errors.push('"root" debe ser un arreglo de elementos.');
  if (layout.status !== undefined && layout.status !== "draft" && layout.status !== "published") {
    errors.push(`"status" debe ser "draft" o "published" (recibido: ${JSON.stringify(layout.status)}).`);
  }
  // v0.0.9.11: tema por pagina. Solo se valida el FORMATO (slug); el
  // membership contra el catalogo lo hace apply_theme al escribir, porque
  // aqui no hay catalogo a mano y un tema desconocido cae honradamente al
  // skin del sitio en el render (fallback, nunca crash).
  if (layout.theme !== undefined && (typeof layout.theme !== "string" || !THEME_NAME_PATTERN.test(layout.theme))) {
    errors.push(`"theme" debe ser un nombre de tema (slug): recibido ${JSON.stringify(layout.theme)}.`);
  }

  layout.root?.forEach((node, i) => validateNode(node, `root[${i}]`, errors, hasType));

  return { valid: errors.length === 0, errors };
}
