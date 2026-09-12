// Validacion minima del formato de pagina antes de guardarlo o renderizarlo.
// Evita que un layout corrupto (por ejemplo, tras un bug del editor) llegue
// al motor de render y rompa el build estatico completo del sitio.

import type { PageLayout, ElementNode } from "../types";
import { elementRegistry } from "../elements/registry";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateNode(node: ElementNode, path: string, errors: string[]): void {
  if (!elementRegistry[node.type]) {
    errors.push(`${path}: tipo de elemento desconocido "${node.type}"`);
    return;
  }
  if (!node.id) {
    errors.push(`${path}: falta "id" en el nodo`);
  }
  node.children?.forEach((child, i) => validateNode(child, `${path}.children[${i}]`, errors));
}

export function validatePageLayout(layout: PageLayout): ValidationResult {
  const errors: string[] = [];

  if (layout.version !== "0.1") errors.push(`Versión de esquema no soportada: ${layout.version}`);
  if (!layout.slug) errors.push('Falta "slug" en la página.');
  if (!Array.isArray(layout.root)) errors.push('"root" debe ser un arreglo de elementos.');

  layout.root?.forEach((node, i) => validateNode(node, `root[${i}]`, errors));

  return { valid: errors.length === 0, errors };
}
