// Utilidades minimas de HTML5 Drag & Drop, sin dependencias externas.
// Atomic Elements deliberadamente no usa una libreria de DnD de terceros
// (react-dnd, sortablejs, etc.) para mantener el bundle final pequeno --
// coherente con el objetivo de ser mas liviano que Elementor.
//
// Phase 2 (editor polish): mientras se arrastra sobre una zona soltable
// se muestra una linea de insercion (.ae-drop-indicator) en la posicion
// exacta donde caera el elemento, y dragleave solo limpia cuando el puntero
// SALE de la zona de verdad (relatedTarget fuera), no al pasar por encima
// de un hijo -- antes el borde parpadeaba al arrastrar sobre bloques.

export interface DragPayload {
  kind: "new-element" | "move-element";
  elementType?: string;
  nodeId?: string;
}

export function makeDraggable(el: HTMLElement, payload: DragPayload): void {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("application/json", JSON.stringify(payload));
    e.dataTransfer!.effectAllowed = "copyMove";
  });
}

export function makeDropZone(
  el: HTMLElement,
  onDrop: (payload: DragPayload, dropIndex: number) => void
): void {
  const computeDropIndex = (clientY: number): { dropIndex: number; children: HTMLElement[] } => {
    // Excluye el indicador mismo: si fuera hijo normal desplazaria los indices.
    const children = [...el.children].filter(
      (c) => !c.classList.contains("ae-drop-indicator")
    ) as HTMLElement[];
    let dropIndex = children.length;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        dropIndex = i;
        break;
      }
    }
    return { dropIndex, children };
  };

  const showIndicator = (dropIndex: number, children: HTMLElement[]): void => {
    let indicator = el.querySelector<HTMLElement>(":scope > .ae-drop-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "ae-drop-indicator";
      indicator.setAttribute("aria-hidden", "true");
    }
    if (dropIndex >= children.length) {
      el.appendChild(indicator);
    } else {
      el.insertBefore(indicator, children[dropIndex]);
    }
  };

  const cleanup = (): void => {
    el.classList.remove("ae-drop-active");
    el.querySelector<HTMLElement>(":scope > .ae-drop-indicator")?.remove();
  };

  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("ae-drop-active");
    const { dropIndex, children } = computeDropIndex(e.clientY);
    showIndicator(dropIndex, children);
  });
  el.addEventListener("dragleave", (e) => {
    // Solo limpiar si el puntero salio de la zona de verdad (no al
    // entrar a un hijo -- relatedTarget es el elemento destino).
    if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
    cleanup();
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    cleanup();
    const raw = e.dataTransfer?.getData("application/json");
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    const { dropIndex } = computeDropIndex(e.clientY);
    onDrop(payload, dropIndex);
  });
}
