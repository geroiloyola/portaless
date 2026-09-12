// Motor de renderizado compartido entre el editor (navegador) y el build
// estatico de Astro (Node). Recorre un PageLayout y produce el HTML final
// usando exclusivamente el elementRegistry -- por eso lo que ves en el
// editor es exactamente lo que se publica, sin paso de "traduccion" que
// pueda introducir divergencias.

import type { ElementNode, PageLayout } from "./types";
import { elementRegistry } from "./elements/registry";

export function renderNode(node: ElementNode): string {
  const definition = elementRegistry[node.type];
  if (!definition) {
    return `<!-- Elemento desconocido: ${node.type} -->`;
  }

  const props = { ...definition.defaultProps, ...node.props };

  if (node.type === "Columns" && node.children?.length) {
    const childrenHTML = node.children.map(renderNode).join("\n");
    return definition.renderHTML(props, childrenHTML);
  }

  return definition.renderHTML(props);
}

export function renderPage(layout: PageLayout): string {
  return layout.root.map(renderNode).join("\n");
}

export function createEmptyPage(slug: string, title: string): PageLayout {
  return { version: "0.1", slug, title, root: [] };
}
