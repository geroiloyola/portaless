// Utilidades minimas de HTML5 Drag & Drop, sin dependencias externas.
// Atomic Elements deliberadamente no usa una libreria de DnD de terceros
// (react-dnd, sortablejs, etc.) para mantener el bundle final pequeno --
// coherente con el objetivo de ser mas liviano que Elementor.

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
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("ae-drop-active");
  });
  el.addEventListener("dragleave", () => el.classList.remove("ae-drop-active"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("ae-drop-active");
    const raw = e.dataTransfer?.getData("application/json");
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;

    // Calcula en que posicion se solto, comparando la coordenada Y contra
    // los hijos actuales del contenedor -- suficiente para un MVP de
    // reordenamiento vertical simple.
    const children = [...el.children] as HTMLElement[];
    let dropIndex = children.length;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        dropIndex = i;
        break;
      }
    }
    onDrop(payload, dropIndex);
  });
}
