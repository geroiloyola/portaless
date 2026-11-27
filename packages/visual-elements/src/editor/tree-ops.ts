// Operaciones puras sobre el arbol de un PageLayout (sin DOM, sin efectos
// secundarios salvo la mutacion explicita del `draft` que recibe cada
// funcion). Se extrajeron de AtomicElementsEditor para que el reordenamiento
// por drag & drop (item 5 del roadmap v0.0.9) sea testeable con Vitest en un
// entorno Node normal, sin necesitar jsdom/happy-dom (el repo no los
// instala, y no se agrega esa dependencia solo para esto).

import type { ElementNode, PageLayout } from "../types";

export type TreePath = number[];

// Resuelve el arreglo (columnSlot o la raiz) al que apunta `path`, creando
// columnSlots vacios sobre la marcha si el nodo todavia no los tiene --
// misma semantica que el metodo privado que tenia AtomicElementsEditor.
export function resolveContainer(draft: PageLayout, path: TreePath): ElementNode[] {
  if (path.length === 0) return draft.root;
  let container: ElementNode[] = draft.root;
  let nodes: ElementNode[] = draft.root;
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

// Recorre `path` (formato [nodeIndex, slotIndex, nodeIndex, slotIndex...])
// y verifica si algun nodo atravesado en la cadena tiene `nodeId` -- usado
// por moveNodeInTree para no permitir soltar un elemento dentro de un
// descendiente de si mismo (lo que corrompería el arbol).
export function pathContainsNodeId(draft: PageLayout, path: TreePath, nodeId: string): boolean {
  let nodes: ElementNode[] = draft.root;
  for (let i = 0; i < path.length - 1; i += 2) {
    const nodeIndex = path[i];
    const slotIndex = path[i + 1];
    const node = nodes[nodeIndex];
    if (!node) return false;
    if (node.id === nodeId) return true;
    const slots = node.columnSlots ?? [];
    nodes = slots[slotIndex] ?? [];
  }
  return false;
}

export interface MoveNodeResult {
  moved: boolean;
  reason?: "not-found" | "target-inside-self";
}

// Mueve el nodo `nodeId` (buscado en cualquier profundidad de `draft.root`)
// a `targetPath`/`targetIndex`. Muta `draft` in place. Devuelve un resultado
// para que el llamador (la UI, o un test) sepa si de verdad se movio algo.
//
// Casos manejados:
// - El nodo no existe en el arbol -> {moved: false, reason: "not-found"}.
// - El destino cae dentro del propio subarbol del nodo (p.ej. arrastrar una
//   columna hacia uno de sus propios slots) -> se aborta sin mutar el
//   arbol, {moved: false, reason: "target-inside-self"}.
// - Reordenamiento dentro del MISMO contenedor hacia una posicion
//   posterior: el `targetIndex` recibido se calculo contra el DOM/arbol
//   ANTES de remover el nodo, asi que una vez removido los indices
//   posteriores al de origen se corren 1 hacia atras -- se ajusta
//   automaticamente para que el nodo termine en la posicion visual
//   correcta.
export function moveNodeInTree(
  draft: PageLayout,
  nodeId: string,
  targetPath: TreePath,
  targetIndex: number
): MoveNodeResult {
  // IMPORTANTE: el contenedor destino se resuelve ANTES de remover el nodo
  // de origen, y se guarda la REFERENCIA AL ARRAY (no el path numerico).
  // `targetPath` viene calculado por la UI contra el arbol actual (con el
  // nodo de origen todavia en su lugar); si en cambio resolvieramos el
  // path DESPUES de la remocion, cualquier nodeIndex en targetPath que
  // apunte a un hermano posterior al nodo removido (en cualquier nivel del
  // arbol, no solo el ultimo) quedaria corrido una posicion y apuntaria al
  // nodo equivocado -- por eso se resuelve la referencia primero.
  //
  // Ademas, si el propio targetPath entra en el subarbol del nodo movido
  // (p.ej. arrastrar una columna hacia uno de sus propios slots),
  // pathContainsNodeId lo detecta contra el arbol TODAVIA INTACTO (el nodo
  // aun no se removio), asi que la deteccion es correcta incluso para el
  // propio nodo raiz del subarbol.
  if (pathContainsNodeId(draft, targetPath, nodeId)) {
    return { moved: false, reason: "target-inside-self" };
  }
  const container = resolveContainer(draft, targetPath);

  let removedNode: ElementNode | null = null;
  let removedFromContainer: ElementNode[] | null = null;
  let removedFromIndex = -1;

  const removeFrom = (nodes: ElementNode[]): boolean => {
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx !== -1) {
      removedNode = nodes.splice(idx, 1)[0];
      removedFromContainer = nodes;
      removedFromIndex = idx;
      return true;
    }
    for (const n of nodes) {
      if (n.columnSlots?.some((slot) => removeFrom(slot))) return true;
    }
    return false;
  };
  removeFrom(draft.root);

  if (!removedNode) {
    return { moved: false, reason: "not-found" };
  }

  // Cuando el nodo se mueve DENTRO DEL MISMO contenedor (misma referencia
  // de array) hacia una posicion posterior a la suya, el dropIndex fue
  // calculado contra el DOM/arbol ANTES de remover este nodo -- una vez
  // removido, todos los indices posteriores a `removedFromIndex` en ESE
  // MISMO contenedor se corren 1 hacia atras, asi que se ajusta el indice
  // de insercion para que el nodo termine en la posicion visual correcta.
  let adjustedIndex = targetIndex;
  if (container === removedFromContainer && targetIndex > removedFromIndex) {
    adjustedIndex -= 1;
  }

  const clampedIndex = Math.max(0, Math.min(adjustedIndex, container.length));
  container.splice(clampedIndex, 0, removedNode);
  return { moved: true };
}
