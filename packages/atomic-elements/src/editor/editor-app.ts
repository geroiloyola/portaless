// Bootstrap del editor visual completo: paleta de elementos + lienzo con
// drag & drop + panel de propiedades + guardado. Este archivo monta la
// aplicacion dentro de un contenedor dado -- no asume ningun framework de
// UI, para poder incrustarse tanto en una ruta admin de Astro como en un
// panel SPA independiente.

import type { ElementNode, PageLayout } from "../types";
import { elementRegistry, elementPalette } from "../elements/registry";
import { renderNode } from "../render";
import { makeDraggable, makeDropZone } from "./drag-drop";
import { renderPropertyPanel } from "./property-panel";
import type { PageStore } from "../persistence/page-store";

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export interface EditorAppOptions {
  container: HTMLElement;
  store: PageStore;
  initialPage: PageLayout;
}

export class AtomicElementsEditor {
  private page: PageLayout;
  private selectedId: string | null = null;
  private store: PageStore;
  private root: HTMLElement;

  constructor(private options: EditorAppOptions) {
    this.page = options.initialPage;
    this.store = options.store;
    this.root = options.container;
    this.render();
  }

  private findNode(id: string, nodes: ElementNode[] = this.page.root): ElementNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this.findNode(id, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  private insertAt(type: keyof typeof elementRegistry, index: number): void {
    const definition = elementRegistry[type];
    const newNode: ElementNode = {
      id: uid(),
      type: type as ElementNode["type"],
      props: { ...definition.defaultProps },
      children: type === "Columns" ? [] : undefined,
    };
    this.page.root.splice(index, 0, newNode);
    this.selectedId = newNode.id;
    this.render();
  }

  private removeNode(id: string): void {
    this.page.root = this.page.root.filter((n) => n.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.render();
  }

  private updateSelectedProps(props: Record<string, unknown>): void {
    if (!this.selectedId) return;
    const node = this.findNode(this.selectedId);
    if (node) node.props = props;
    this.render();
  }

  async save(): Promise<void> {
    await this.store.save(this.page);
  }

  exportJSON(): string {
    return JSON.stringify(this.page, null, 2);
  }

  private render(): void {
    this.root.innerHTML = "";
    this.root.className = "ae-shell";

    // --- Paleta ---
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

    // --- Lienzo ---
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "ae-canvas-wrap";
    const canvas = document.createElement("div");
    canvas.className = "ae-canvas";

    makeDropZone(canvas, (payload, dropIndex) => {
      if (payload.kind === "new-element" && payload.elementType) {
        this.insertAt(payload.elementType as keyof typeof elementRegistry, dropIndex);
      }
    });

    this.page.root.forEach((node) => {
      const block = document.createElement("div");
      block.className = "ae-block" + (this.selectedId === node.id ? " ae-selected" : "");
      block.innerHTML = renderNode(node);

      const toolbar = document.createElement("div");
      toolbar.className = "ae-block-toolbar";
      toolbar.innerHTML = `<span>${elementRegistry[node.type].icon} ${elementRegistry[node.type].displayName}</span>`;
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "✕";
      deleteBtn.onclick = (e) => { e.stopPropagation(); this.removeNode(node.id); };
      toolbar.appendChild(deleteBtn);

      block.prepend(toolbar);
      block.addEventListener("click", () => { this.selectedId = node.id; this.render(); });
      canvas.appendChild(block);
    });

    canvasWrap.appendChild(canvas);

    // --- Panel de propiedades ---
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
