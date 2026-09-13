import type { ElementNode, PageLayout } from "./types";
import { elementRegistry } from "./elements/registry";

export async function renderNode(node: ElementNode): Promise<string> {
  const definition = elementRegistry[node.type];
  if (!definition) return `<!-- Elemento desconocido: ${node.type} -->`;
  const props = { ...definition.defaultProps, ...node.props };

  if (node.type === "Columns") {
    const slots = node.columnSlots ?? (node.children?.length ? [node.children] : []);
    const slotsHTML = await Promise.all(
      slots.map(async (slotNodes) => {
        const rendered = await Promise.all(slotNodes.map(renderNode));
        return `<div class="ae-column-slot">${rendered.join("\n")}</div>`;
      })
    );
    const childrenHTML = slotsHTML.join("\n");
    return definition.renderHTMLAsync
      ? await definition.renderHTMLAsync(props, childrenHTML)
      : definition.renderHTML(props, childrenHTML);
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
