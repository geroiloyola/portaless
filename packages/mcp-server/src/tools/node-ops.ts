// Operaciones puras sobre el arbol de bloques de un PageLayout, direccionadas
// por nodeId (no por path numerico). Existen para que las tools de contenido
// del MCP server (insert_block / update_block / delete_block) puedan mutar un
// arbol sin reemplazarlo entero, que era lo unico que permitia update_page.
//
// POR QUE NO REUTILIZA editor/tree-ops.ts: ese modulo es path-based y MUETA el
// draft in place, pensado para el drag & drop del editor visual (donde la UI ya
// conoce los indices). Aqui el llamador es un agente remoto: los indices son
// fragiles entre invocaciones, los nodeIds son estables, y queremos un arbol
// nuevo en vez de mutar el que vino del store. Concerns distintos, por eso es
// un modulo aparte.
//
// INMUTABILIDAD: cada operacion clona el arbol (JSON round-trip, misma
// convencion que editor/history.ts y editor-app.ts) y devuelve el clone ya
// modificado. El arbol de entrada nunca se toca, asi que un error a mitad de
// camino deja el layout original intacto.

import type { ElementNode } from "../../../atomic-elements/src/types";

export type NodeLocation = {
  container: ElementNode[];
  index: number;
  node: ElementNode;
};

function cloneRoot(root: ElementNode[]): ElementNode[] {
  return JSON.parse(JSON.stringify(root));
}

// Busca `id` en root, children y columnSlots. Devuelve la referencia al array
// contenedor y al nodo dentro de el -- la misma estructura que necesitan
// insert/update/delete para apuntar al lugar correcto.
export function findNodeLocation(root: ElementNode[], id: string): NodeLocation | null {
  for (let i = 0; i < root.length; i++) {
    const node = root[i];
    if (node.id === id) return { container: root, index: i, node };
    const inChildren = node.children ? findNodeLocation(node.children, id) : null;
    if (inChildren) return inChildren;
    if (node.columnSlots) {
      for (const slot of node.columnSlots) {
        const inSlot = findNodeLocation(slot, id);
        if (inSlot) return inSlot;
      }
    }
  }
  return null;
}

export type InsertResult =
  | { ok: true; root: ElementNode[] }
  | { ok: false; error: string };

// Inserta `node` en el contenedor apuntado por `parentId` (omitido = root).
// `index` debe estar en [0, contenedor.length]; fuera de rango es ERROR, no se
// recorta en silencio -- un agente que pida una posicion erronea debe enterarse,
// no recibir un arbol que no es el que pidio.
//
// Direccion de columnas: si el padre tiene `columnSlots`, `slotIndex` elige el
// slot (default 0). Sin columnSlots se usa `children` del padre (creandolo si no
// existe). Asi un agente puede insertar dentro de una columna concreta sin
// tener que reconstruir el arbol entero.
export function insertNode(
  root: ElementNode[],
  parentId: string | undefined,
  index: number,
  node: ElementNode,
  slotIndex?: number
): InsertResult {
  const next = cloneRoot(root);
  let container: ElementNode[];

  if (parentId === undefined) {
    container = next;
  } else {
    const parentLoc = findNodeLocation(next, parentId);
    if (!parentLoc) {
      return { ok: false, error: `No existe un nodo con id '${parentId}' para insertar dentro.` };
    }
    const parent = parentLoc.node;
    if (parent.columnSlots) {
      const slot = slotIndex ?? 0;
      if (slot < 0 || slot >= parent.columnSlots.length) {
        return {
          ok: false,
          error: `slotIndex ${slot} fuera de rango para '${parentId}' (${parent.columnSlots.length} slot(s)).`,
        };
      }
      container = parent.columnSlots[slot];
    } else {
      if (!parent.children) parent.children = [];
      container = parent.children;
    }
  }

  if (!Number.isInteger(index) || index < 0 || index > container.length) {
    return {
      ok: false,
      error: `index ${index} fuera de rango para un contenedor de ${container.length} elemento(s) (valido: 0..${container.length}).`,
    };
  }
  container.splice(index, 0, node);
  return { ok: true, root: next };
}

export type UpdateResult =
  | { ok: true; root: ElementNode[] }
  | { ok: false; error: string };

// Aplica un patch superficial sobre las props de un nodo. No toca children ni
// columnSlots (para eso esta insert/delete/move). Un valor `undefined` en el
// patch elimina esa clave.
export function updateNodeProps(
  root: ElementNode[],
  id: string,
  props: Record<string, unknown>
): UpdateResult {
  const next = cloneRoot(root);
  const loc = findNodeLocation(next, id);
  if (!loc) return { ok: false, error: `No existe un nodo con id '${id}'.` };
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) delete loc.node.props[key];
    else loc.node.props[key] = value;
  }
  return { ok: true, root: next };
}

export type DeleteResult =
  | { ok: true; root: ElementNode[] }
  | { ok: false; error: string };

export function deleteNode(root: ElementNode[], id: string): DeleteResult {
  const next = cloneRoot(root);
  const loc = findNodeLocation(next, id);
  if (!loc) return { ok: false, error: `No existe un nodo con id '${id}'.` };
  loc.container.splice(loc.index, 1);
  return { ok: true, root: next };
}
