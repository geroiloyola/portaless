import type { ElementNode, PageLayout, ElementType } from "../types";
import { elementRegistry, elementPalette } from "../elements/registry";
import type { ResolvedCatalog, CatalogEntry } from "../elements/element-pack";
import { coreCatalog } from "../elements/element-pack";
import { renderContributedTemplate } from "../render";
import { iconLabel, iconOnly, ICON_FOLDER, ICON_UNDO_2, ICON_REDO_2 } from "../elements/icons";
import { makeDraggable, makeDropZone } from "./drag-drop";
import { renderPropertyPanel } from "./property-panel";
import type { PageStore } from "../persistence/page-store";
import { EditorHistory } from "./history";
import { resolveContainer as resolveContainerInTree, moveNodeInTree } from "./tree-ops";
import {
  ProductPreviewLoader,
  clampPreviewQuery,
  productPreviewKey,
  type ProductPreviewFetcher,
  type ProductPreviewState,
} from "./product-preview-loader";

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

type Path = number[];

export interface EditorAppOptions {
  container: HTMLElement;
  store: PageStore;
  initialPage: PageLayout;
  /**
   * v0.0.9.28: lo inyecta la pagina del Dashboard (src/pages/admin/editor.astro),
   * que habla con /admin/api/product-preview con la sesion del admin. Sin el,
   * ProductGrid muestra su placeholder estatico (renderHTML).
   */
  fetchProductPreview?: ProductPreviewFetcher;
  /**
   * v0.0.9.11: catalogo core ∪ element packs que la paleta, el canvas y el
   * panel de propiedades consumen. Lo inyecta editor.astro tras leer
   * GET /admin/api/element-packs y fusionarlo con el core embebido en el
   * bundle. Sin el, el editor usa el core cerrado (comportamiento previo).
   */
  elementCatalog?: ResolvedCatalog;
}

/** Vista normalizada de una entrada del catalogo, core o pack, para el editor. */
interface EntryView {
  kind: "core" | "pack";
  type: string;
  displayName: string;
  icon: string;
  defaultProps: Record<string, unknown>;
  entry: CatalogEntry;
}

export class AtomicElementsEditor {
  private history: EditorHistory;
  private selectedId: string | null = null;
  private store: PageStore;
  private root: HTMLElement;
  private productPreview: ProductPreviewLoader | null = null;
  private catalog: ResolvedCatalog;
  private persistedRevisionId: string | null;

  constructor(private options: EditorAppOptions) {
    this.history = new EditorHistory(options.initialPage);
    this.store = options.store;
    this.persistedRevisionId = options.initialPage.revisionId ?? null;
    this.root = options.container;
    this.catalog = options.elementCatalog ?? coreCatalog(elementRegistry, elementPalette);
    if (options.fetchProductPreview) {
      this.productPreview = new ProductPreviewLoader(options.fetchProductPreview, (key, state) =>
        this.patchProductPreviews(key, state)
      );
    }
    this.bindKeyboardShortcuts();
    this.render();
  }

  // Normaliza una entrada del catalogo (core o pack) a los campos que el
  // editor consume (icono, nombre, defaultProps). Sin esto, cada lookup usaba
  // elementRegistry directo y un nodo de pack seria `undefined` y crashearia.
  private entryView(type: string): EntryView | null {
    const entry = this.catalog.lookup(type);
    if (!entry) return null;
    return entry.kind === "core"
      ? {
          kind: "core",
          type,
          displayName: entry.definition.displayName,
          icon: entry.definition.icon,
          defaultProps: entry.definition.defaultProps as Record<string, unknown>,
          entry,
        }
      : {
          kind: "pack",
          type,
          displayName: entry.element.displayName,
          icon: entry.element.icon,
          defaultProps: entry.element.defaultProps,
          entry,
        };
  }

  private get page(): PageLayout {
    return this.history.getCurrent();
  }

  private bindKeyboardShortcuts(): void {
    this.root.ownerDocument?.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
      }
    });
  }

  private undo(): void {
    const previous = this.history.undo();
    if (previous) this.render();
  }

  private redo(): void {
    const next = this.history.redo();
    if (next) this.render();
  }

  private commit(mutate: (draft: PageLayout) => void): void {
    const draft: PageLayout = JSON.parse(JSON.stringify(this.page));
    mutate(draft);
    this.history.push(draft);
    this.render();
  }

  private resolveContainer(draft: PageLayout, path: Path): ElementNode[] {
    return resolveContainerInTree(draft, path);
  }

  private insertAt(type: string, path: Path, index: number): void {
    const view = this.entryView(type);
    if (!view) return;
    this.commit((draft) => {
      const newNode: ElementNode = {
        id: uid(),
        type: type as ElementType,
        props: { ...view.defaultProps },
        columnSlots: type === "Columns" ? [[], []] : undefined,
      };
      const container = this.resolveContainer(draft, path);
      container.splice(index, 0, newNode);
      this.selectedId = newNode.id;
    });
  }

  private removeNode(id: string): void {
    this.commit((draft) => {
      const removeFrom = (nodes: ElementNode[]): boolean => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx !== -1) {
          nodes.splice(idx, 1);
          return true;
        }
        for (const n of nodes) {
          if (n.columnSlots?.some((slot) => removeFrom(slot))) return true;
        }
        return false;
      };
      removeFrom(draft.root);
      if (this.selectedId === id) this.selectedId = null;
    });
  }

  // Reordenamiento por drag & drop de un nodo YA EXISTENTE (no de la
  // paleta). Delega la logica pura de arbol a tree-ops.ts (testeada por
  // separado con Vitest, sin necesitar DOM) y solo se encarga de la parte
  // especifica del editor: envolver la mutacion en un commit (una sola
  // entrada de historial para undo/redo) y actualizar la seleccion.
  private moveNode(nodeId: string, targetPath: Path, targetIndex: number): void {
    this.commit((draft) => {
      const result = moveNodeInTree(draft, nodeId, targetPath, targetIndex);
      if (result.moved) this.selectedId = nodeId;
    });
  }

  private findNode(id: string, nodes: ElementNode[] = this.page.root): ElementNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.columnSlots) {
        for (const slot of node.columnSlots) {
          const found = this.findNode(id, slot);
          if (found) return found;
        }
      }
    }
    return null;
  }

  private updateSelectedProps(props: Record<string, unknown>): void {
    if (!this.selectedId) return;
    this.commit((draft) => {
      const node = this.findNode(this.selectedId as string, draft.root);
      if (node) node.props = props;
    });
  }

  async save(): Promise<void> {
    const revision = await this.store.save(this.page, { expectedRevisionId: this.persistedRevisionId });
    if (revision?.revisionId) {
      this.persistedRevisionId = revision.revisionId;
      Object.assign(this.page, {
        publicationId: revision.publicationId, revisionId: revision.revisionId,
        revisionNo: revision.revisionNo, contentHash: revision.contentHash,
      });
    }
  }

  exportJSON(): string {
    return JSON.stringify(this.page, null, 2);
  }

  private renderToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "ae-history-toolbar";

    const undoBtn = document.createElement("button");
    const undoIcon = iconOnly(ICON_UNDO_2);
    if (undoIcon) undoBtn.appendChild(undoIcon);
    undoBtn.setAttribute("aria-label", "Deshacer");
    undoBtn.title = "Deshacer";
    undoBtn.disabled = !this.history.canUndo;
    undoBtn.onclick = () => this.undo();

    const redoBtn = document.createElement("button");
    const redoIcon = iconOnly(ICON_REDO_2);
    if (redoIcon) redoBtn.appendChild(redoIcon);
    redoBtn.setAttribute("aria-label", "Rehacer");
    redoBtn.title = "Rehacer";
    redoBtn.disabled = !this.history.canRedo;
    redoBtn.onclick = () => this.redo();

    toolbar.appendChild(undoBtn);
    toolbar.appendChild(redoBtn);

    // Phase 2 (exit criterion): sin esta vuelta el usuario no podia abrir
    // una segunda pagina sin teclear la URL a mano. /admin/pages lista y
    // crea; el editor enlaza de vuelta. El hueco entre rehacer y el
    // titulo empuja el enlace a la derecha.
    const spacer = document.createElement("span");
    spacer.className = "ae-toolbar-spacer";
    toolbar.appendChild(spacer);

    const pagesLink = document.createElement("a");
    pagesLink.className = "ae-toolbar-link";
    pagesLink.href = "/admin/pages";
    pagesLink.appendChild(iconLabel(ICON_FOLDER, "Mis páginas"));
    toolbar.appendChild(pagesLink);

    return toolbar;
  }

  // v0.0.9.28: HTML de un ProductGrid segun el estado de su carga real.
  // `fallback` es el placeholder estatico de renderHTML.
  private productPreviewHTML(state: ProductPreviewState, fallback: string): string {
    const note = (text: string, color: string) =>
      `<div style="font-size:11px;color:${color};margin-top:6px;">${esc(text)}</div>`;
    if (state.status === "ready") return state.html;
    if (state.status === "loading") return fallback + note("Cargando productos reales\u2026", "#888");
    return fallback + note(`No se pudo cargar la vista previa: ${state.error}`, "#ff8f8f");
  }

  // Reemplaza SOLO los bloques ProductGrid afectados, sin re-renderizar el
  // editor entero (no se pierde el foco del panel de propiedades).
  private patchProductPreviews(key: string, state: ProductPreviewState): void {
    this.root.querySelectorAll<HTMLElement>("[data-product-preview-key]").forEach((el) => {
      if (el.dataset.productPreviewKey !== key) return;
      const fallback = elementRegistry.ProductGrid.renderHTML({
        source: "medusa",
        columns: Number(el.dataset.columns),
        limit: Number(el.dataset.limit),
      });
      el.innerHTML = this.productPreviewHTML(state, fallback);
    });
  }

  // v0.0.9.28: antes el canvas solo mostraba la barra (icono + nombre) de
  // cada bloque, sin vista previa. Ahora renderiza el HTML real del registro
  // (que ya escapa sus props con esc()). pointer-events:none para que un
  // click seleccione el bloque en vez de seguir enlaces de la vista previa.
  private renderPreview(node: ElementNode): HTMLElement {
    const preview = document.createElement("div");
    preview.className = "ae-block-preview";
    preview.style.pointerEvents = "none";

    const view = this.entryView(node.type);
    if (!view) {
      preview.innerHTML = `<div style="font-size:11px;color:#ff8f8f;">Tipo desconocido: ${esc(node.type)}</div>`;
      return preview;
    }
    const props: any = { ...view.defaultProps, ...(node.props as Record<string, unknown>) };

    try {
      if (view.kind === "pack") {
        // Nodo de pack: el host interpola el template (mismo codigo que el
        // render de build), con props ya escapadas por renderContributedTemplate.
        const element = (view.entry as { element: { render: { template: string } } }).element;
        preview.innerHTML = renderContributedTemplate(
          element as never,
          props as Record<string, unknown>
        );
      } else if (node.type === "ProductGrid" && props.source === "medusa" && this.productPreview) {
        const def = elementRegistry.ProductGrid;
        const query = clampPreviewQuery(props);
        preview.dataset.productPreviewKey = productPreviewKey(query);
        preview.dataset.columns = String(query.columns);
        preview.dataset.limit = String(query.limit);
        const fallback = def.renderHTML({ ...props, ...query });
        preview.innerHTML = this.productPreviewHTML(this.productPreview.get(query), fallback);
      } else {
        const def = elementRegistry[node.type as ElementType];
        preview.innerHTML = def.renderHTML(props);
      }
    } catch (err) {
      preview.innerHTML = `<div style="font-size:11px;color:#ff8f8f;">Error al renderizar: ${esc((err as Error).message)}</div>`;
    }
    return preview;
  }

  private renderEditableNode(node: ElementNode, path: Path): HTMLElement {
    const block = document.createElement("div");
    block.className = "ae-block" + (this.selectedId === node.id ? " ae-selected" : "");

    const toolbar = document.createElement("div");
    toolbar.className = "ae-block-toolbar";
    const blockView = this.entryView(node.type);
    toolbar.appendChild(iconLabel(blockView?.icon ?? "❓", blockView?.displayName ?? node.type));
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "\u2715";
    deleteBtn.onclick = (e) => { e.stopPropagation(); this.removeNode(node.id); };
    toolbar.appendChild(deleteBtn);
    block.appendChild(toolbar);

    block.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectedId = node.id;
      this.render();
    });

    // Hace que este bloque YA RENDERIZADO en el canvas sea arrastrable
    // para reordenarlo, ademas de los items de la paleta que crean
    // elementos nuevos. El payload usa "move-element" + nodeId (en vez
    // de "new-element" + elementType) para que los onDrop de mas abajo
    // sepan que deben mover el nodo existente en lugar de instanciar uno.
    makeDraggable(block, { kind: "move-element", nodeId: node.id });

    if (node.type === "Columns") {
      const slots = node.columnSlots ?? (node.children?.length ? [node.children] : [[], []]);
      const grid = document.createElement("div");
      grid.className = "ae-columns-editable";
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = `repeat(${(node.props as any).count ?? slots.length}, 1fr)`;
      grid.style.gap = `${(node.props as any).gap ?? 16}px`;

      slots.forEach((slotNodes, slotIndex) => {
        const slotEl = document.createElement("div");
        slotEl.className = "ae-column-slot-editable";
        const slotPath = [...path, slotIndex];

        slotNodes.forEach((child, childIndex) => {
          slotEl.appendChild(this.renderEditableNode(child, [...slotPath, childIndex]));
        });

        if (slotNodes.length === 0) {
          const placeholder = document.createElement("div");
          placeholder.className = "ae-empty-slot";
          placeholder.textContent = "Suelta un elemento aqui";
          slotEl.appendChild(placeholder);
        }

        makeDropZone(slotEl, (payload, dropIndex) => {
          if (payload.kind === "new-element" && payload.elementType) {
            this.insertAt(payload.elementType as ElementType, slotPath, dropIndex);
          } else if (payload.kind === "move-element" && payload.nodeId) {
            this.moveNode(payload.nodeId, slotPath, dropIndex);
          }
        });

        grid.appendChild(slotEl);
      });

      block.appendChild(grid);
    } else {
      block.appendChild(this.renderPreview(node));
    }

    return block;
  }

  private render(): void {
    this.root.innerHTML = "";
    this.root.className = "ae-shell";

    const palette = document.createElement("div");
    palette.className = "ae-palette";
    palette.innerHTML = `<h3>Elementos</h3>`;
    this.catalog.palette().forEach((entry) => {
      const item = document.createElement("div");
      item.className = "ae-palette-item";
      if (entry.kind === "pack") {
        // Marca visual minima: un elemento de pack no es core. Sin CSS nuevo
        // obligatorio -- el asterisco lo entiende cualquiera.
        item.appendChild(iconLabel(entry.element.icon, `${entry.element.displayName} *`));
      } else {
        item.appendChild(iconLabel(entry.definition.icon, entry.definition.displayName));
      }
      makeDraggable(item, { kind: "new-element", elementType: entry.type });
      palette.appendChild(item);
    });

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "ae-canvas-wrap";
    canvasWrap.appendChild(this.renderToolbar());

    const canvas = document.createElement("div");
    canvas.className = "ae-canvas";

    makeDropZone(canvas, (payload, dropIndex) => {
      if (payload.kind === "new-element" && payload.elementType) {
        this.insertAt(payload.elementType as ElementType, [], dropIndex);
      } else if (payload.kind === "move-element" && payload.nodeId) {
        this.moveNode(payload.nodeId, [], dropIndex);
      }
    });

    this.page.root.forEach((node, index) => {
      canvas.appendChild(this.renderEditableNode(node, [index]));
    });

    canvasWrap.appendChild(canvas);

    const selectedNode = this.selectedId ? this.findNode(this.selectedId) : null;
    const propertyPanel = renderPropertyPanel(selectedNode, (props) => this.updateSelectedProps(props), this.catalog);

    this.root.appendChild(palette);
    this.root.appendChild(canvasWrap);
    this.root.appendChild(propertyPanel);
  }
}

export function mountAtomicElementsEditor(options: EditorAppOptions): AtomicElementsEditor {
  return new AtomicElementsEditor(options);
}
