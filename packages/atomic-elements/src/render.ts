// Motor de render de Atomic Elements.
//
// v0.0.9.11: gana un catalogo resuelto (core ∪ element packs) y dos modos de
// render. Firmas retro-compatibles: renderNode(node) y renderPage(layout)
// siguen funcionando con los defaults (catalogo core, modo "static").
//
// Los dos modos existen por la regla dura del diseno de catalogs-plugins
// (docs/architecture/element-catalog-plugins.md):
//   - "static"  (build): un nodo con requiresEdgeEval emite un PLACEHOLDER y
//     NO accede a sus props. Los bytes premium nunca entran en dist/.
//   - "request" (runtime): el caller puede pasar un dynamicRenderer que, tras
//     el gate del plugin, resuelve el contenido real en el borde.
// El placeholder recibe solo {type, nodeId} -- por construccion no hay camino
// de codigo para que un valor de secretProps llegue a HTML estatico.

import type { ElementNode, PageLayout, ElementDefinition } from "./types";
import { elementRegistry, elementPalette } from "./elements/registry";
import {
  coreCatalog,
  type CatalogEntry,
  type ContributedElement,
  type ResolvedCatalog,
} from "./elements/element-pack";

export interface RenderOptions {
  /** "static" (default, build-safe) o "request" (runtime, puede resolver edge-eval). */
  mode?: "static" | "request";
  /** Catalogo resuelto. Default: el core sin packs, para callers sin DB. */
  catalog?: ResolvedCatalog;
  /** Resuelve un nodo requiresEdgeEval en modo "request". Si falta, se emite el placeholder. */
  dynamicRenderer?: (node: ElementNode, entry: CatalogEntry) => Promise<string>;
}

let defaultCatalog: ResolvedCatalog | null = null;
function getDefaultCatalog(): ResolvedCatalog {
  if (!defaultCatalog) defaultCatalog = coreCatalog(elementRegistry, elementPalette);
  return defaultCatalog;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// PLACEHOLDER de edge-eval. Recibe SOLO type y nodeId -- deliberadamente no
// recibe props, para que un valor sensible no tenga camino hasta el estatico.
function edgePlaceholder(type: string, nodeId: string): string {
  return (
    `<div data-portaless-edge="${escapeHtml(type)}" data-node-id="${escapeHtml(nodeId)}">` +
    `<noscript>Contenido ${escapeHtml(type)} disponible solo en la version dinamica del sitio.</noscript>` +
    `</div>`
  );
}

// Interpola el template de un elemento de pack. {{clave}} se escapa; el valor
// sale de defaultProps ∪ node.props. {{&children}} inserta el HTML de hijos ya
// renderizado POR EL HOST (no por el plugin), asi que va sin escapar.
// Exportada (v0.0.9.11) para que el editor pinte el preview de un nodo de pack
// en el canvas de forma sincrona, sin necesitar el render async de renderNode.
export function renderContributedTemplate(
  element: ContributedElement,
  props: Record<string, unknown>,
  childrenHtml?: string
): string {
  const merged = { ...element.defaultProps, ...props };
  return element.render.template
    .replace(/\{\{&children\}\}/g, childrenHtml ?? "")
    .replace(/\{\{(\w+)\}\}/g, (_m, key: string) => escapeHtml(String(merged[key] ?? "")));
}

async function renderCoreNode(
  definition: ElementDefinition<Record<string, unknown>>,
  node: ElementNode,
  opts: RenderOptions
): Promise<string> {
  const props = { ...(definition.defaultProps as Record<string, unknown>), ...node.props };

  if (node.type === "Columns") {
    const slots = node.columnSlots ?? (node.children?.length ? [node.children] : []);
    const slotsHTML = await Promise.all(
      slots.map(async (slotNodes) => {
        const rendered = await Promise.all(slotNodes.map((n) => renderNode(n, opts)));
        return `<div class="ae-column-slot">${rendered.join("\n")}</div>`;
      })
    );
    const childrenHtml = slotsHTML.join("\n");
    return definition.renderHTMLAsync
      ? await definition.renderHTMLAsync(props, childrenHtml)
      : definition.renderHTML(props, childrenHtml);
  }

  return definition.renderHTMLAsync
    ? await definition.renderHTMLAsync(props)
    : definition.renderHTML(props);
}

export async function renderNode(node: ElementNode, opts: RenderOptions = {}): Promise<string> {
  const catalog = opts.catalog ?? getDefaultCatalog();
  const mode = opts.mode ?? "static";
  const entry = catalog.lookup(node.type);

  if (!entry) return `<!-- Elemento desconocido: ${node.type} -->`;

  if (entry.kind === "core") {
    return renderCoreNode(entry.definition, node, opts);
  }

  // Nodo de pack.
  const element = entry.element;
  if (element.render.requiresEdgeEval) {
    if (mode === "request" && opts.dynamicRenderer) {
      return opts.dynamicRenderer(node, entry);
    }
    // Modo static, o request sin dynamicRenderer: placeholder honesto.
    // Sin acceder a node.props -- la proteccion de bytes es estructural.
    return edgePlaceholder(element.type, node.id);
  }

  const childrenHtml = node.children?.length
    ? (await Promise.all(node.children.map((c) => renderNode(c, opts)))).join("\n")
    : undefined;
  return renderContributedTemplate(element, node.props, childrenHtml);
}

export async function renderPage(layout: PageLayout, opts: RenderOptions = {}): Promise<string> {
  const rendered = await Promise.all(layout.root.map((n) => renderNode(n, opts)));
  return rendered.join("\n");
}
