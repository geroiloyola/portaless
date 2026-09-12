// Motor de renderizado compartido. ACTUALIZADO v0.0.6: async para soportar renderHTMLAsync.
import type { ElementNode, PageLayout } from "./types";
import { elementRegistry } from "./elements/registry";

export async function renderNode(node: ElementNode): Promise<string> {
  const definition = elementRegistry[node.type];
  if (!definition) return `<!-- Elemento desconocido: ${node.type} -->`;
  const props = { ...definition.defaultProps, ...node.props };
  if (node.type === "Columns" && node.children?.length) {
    const childrenHTML = (await Promise.all(node.children.map(renderNode))).join("\n");
    return definition.renderHTMLAsync ? await definition.renderHTMLAsync(props, childrenHTML) : definition.renderHTML(props, childrenHTML);
  }
  return definition.renderHTMLAsync ? await definition.renderHTMLAsync(props) : definition.renderHTML(props);
}

export async function renderPage(layout: PageLayout): Promise<string> {
  const rendered = await Promise.all(layout.root.map(renderNode));
  return rendered.join("\n");
}

export function createEmptyPage(slug: string, title: string): PageLayout {
  return { version: "0.1", slug, title, root: [] };
}
