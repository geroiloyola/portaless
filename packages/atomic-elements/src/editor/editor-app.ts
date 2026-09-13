import type { ElementNode, PageLayout, ElementType } from "../types";
import { elementRegistry, elementPalette } from "../elements/registry";
import { makeDraggable, makeDropZone } from "./drag-drop";
import { renderPropertyPanel } from "./property-panel";
import type { PageStore } from "../persistence/page-store";
import { EditorHistory } from "./history";

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

type Path = number[];

export interface EditorAppOptions {
  container: HTMLElement;
  store: PageStore;
  initialPage: PageLayout;
}

export class AtomicElementsEditor {
  private history: EditorHistory;
  private selectedId: string | null = null;
  private store: PageStore;
  private root: HTMLElement;

  constructor(private options: EditorAppOptions) {
    this.history = new EditorHistory(options.initialPage);
    this.store = options.store;
    this.root = options.container;
    this.bindKeyboardShortcuts();
    this.render();
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
    if (path.length === 0) return draft.root;
    let nodes: ElementNode[] = draft.root;
    let container: ElementNode[] = draft.root;
    for (let i = 0; i < path.length - 1; i += 2) {
      const nodeIndex = path[i];
      const slotIndex = path[i + 1];
      const node = nodes[nodeIndex];
      if (!node) return draft.root;
      if (!node.columnSlots) node.columnSlots = node.children?.length ? [node.children] : [[], []];
      if (!node.columnSlots[slotIndex]) node.columnSlots[slotIndex] = [];
      container = node.columnSlots[slotIndex];
      nodes = container;
    }
    return container;
  }

  private insertAt(type: ElementType, path: Path, index: number): void {
    this.commit((draft) => {
      const definition = elementRegistry[type];
      const newNode: ElementNode = {
        id: uid(),
        type,
        props: { ...definition.defaultProps },
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
    await this.store.save(this.page);
  }

  exportJSON(): string {
    return JSON.stringify(this.page, null, 2);
  }

  private renderToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "ae-history-toolbar";

    const undoBtn = document.createElement("button");
    undoBtn.textContent = "\u21b6 Deshacer";
    undoBtn.disabled = !this.history.canUndo;
    undoBtn.onclick = () => this.undo();

    const redoBtn = document.createElement("button");
    redoBtn.textContent = "\u21b7 Rehacer";
    redoBtn.disabled = !this.history.canRedo;
    redoBtn.onclick = () => this.redo();

    toolbar.appendChild(undoBtn);
    toolbar.appendChild(redoBtn);
    return toolbar;
  }

  private renderEditableNode(node: ElementNode, path: Path): HTMLElement {
    const block = document.createElement("div");
    block.className = "ae-block" + (this.selectedId === node.id ? " ae-selected" : "");

    const toolbar = document.createElement("div");
    toolbar.className = "ae-block-toolbar";
    toolbar.innerHTML = `<span>${elementRegistry[node.type].icon} ${elementRegistry[node.type].displayName}</span>`;
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
          }
        });

        grid.appendChild(slotEl);
      });

      block.appendChild(grid);
    }

    return block;
  }

  private render(): void {
    this.root.innerHTML = "";
    this.root.className = "ae-shell";

    const palette = document.createElement("div");
    palette.className = "ae-palette";
    palette.innerHTML = `<h3>Elementos</h3>`;
    elementPalette.forEach((type) => {
      const def = elementRegistry[type];
      const item = document.createElement("div");
      item.className = "ae-palette-item";
      item.textContent = `${def.icon} ${def.displayName}`;
      makeDraggable(item, { kind: "new-element", elementType: type });
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
      }
    });

    this.page.root.forEach((node, index) => {
      canvas.appendChild(this.renderEditableNode(node, [index]));
    });

    canvasWrap.appendChild(canvas);

    const selectedNode = this.selectedId ? this.findNode(this.selectedId) : null;
    const propertyPanel = renderPropertyPanel(selectedNode, (props) => this.updateSelectedProps(props));

    this.root.appendChild(palette);
    this.root.appendChild(canvasWrap);
    this.root.appendChild(propertyPanel);
  }
}

export function mountAtomicElementsEditor(options: EditorAppOptions): AtomicElementsEditor {
  return new AtomicElementsEditor(options);
}
