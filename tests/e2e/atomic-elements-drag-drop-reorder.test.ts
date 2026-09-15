// Test de la logica pura de reordenamiento por drag & drop (item 5 del
// roadmap v0.0.9, "Drag-and-drop reorder dentro de column slots"). No usa
// DOM/jsdom -- el repo no instala ningun entorno DOM para Vitest, asi que
// la logica de arbol se extrajo a tree-ops.ts precisamente para poder
// probarla aqui directamente contra un PageLayout en memoria, sin pasar
// por eventos reales de drag/drop del navegador (esos se ejercitan
// manualmente en el editor real; ver README de atomic-elements).

import { describe, it, expect } from "vitest";
import { moveNodeInTree, resolveContainer } from "../../packages/atomic-elements/src/editor/tree-ops";
import type { ElementNode, PageLayout } from "../../packages/atomic-elements/src/types";

function node(id: string, columnSlots?: ElementNode[][]): ElementNode {
  return { id, type: "Paragraph", props: {}, columnSlots };
}

function makePage(root: ElementNode[]): PageLayout {
  return { version: "0.1", slug: "test", title: "Test", root };
}

describe("moveNodeInTree -- reordenamiento drag & drop v0.0.9", () => {
  it("mueve un nodo dentro del mismo contenedor (raiz) hacia una posicion posterior, ajustando el indice", () => {
    // [A, B, C] -- arrastrar A a dropIndex=2 (justo antes de C, visto ANTES
    // de remover A) debe terminar como [B, A, C], no [B, C, A].
    const page = makePage([node("a"), node("b"), node("c")]);
    const result = moveNodeInTree(page, "a", [], 2);
    expect(result.moved).toBe(true);
    expect(page.root.map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("mueve un nodo dentro del mismo contenedor hacia una posicion anterior, sin ajuste de indice", () => {
    // [A, B, C] -- arrastrar C a dropIndex=0 debe dar [C, A, B].
    const page = makePage([node("a"), node("b"), node("c")]);
    const result = moveNodeInTree(page, "c", [], 0);
    expect(result.moved).toBe(true);
    expect(page.root.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("mueve un nodo de la raiz hacia un columnSlot de otro nodo", () => {
    const columns = node("cols", [[], []]);
    const page = makePage([node("a"), columns, node("b")]);
    // path [1, 0] = nodo en indice 1 (columns), slot 0.
    const result = moveNodeInTree(page, "a", [1, 0], 0);
    expect(result.moved).toBe(true);
    expect(page.root.map((n) => n.id)).toEqual(["cols", "b"]);
    expect(columns.columnSlots?.[0].map((n) => n.id)).toEqual(["a"]);
  });

  it("mueve un nodo entre dos slots distintos de la misma fila de columnas", () => {
    const child = node("child");
    const columns = node("cols", [[child], []]);
    const page = makePage([columns]);
    const result = moveNodeInTree(page, "child", [0, 1], 0);
    expect(result.moved).toBe(true);
    expect(columns.columnSlots?.[0]).toEqual([]);
    expect(columns.columnSlots?.[1].map((n) => n.id)).toEqual(["child"]);
  });

  it("rechaza mover un nodo dentro de su propio subarbol y lo deja intacto", () => {
    const child = node("child");
    const columns = node("cols", [[child], []]);
    const page = makePage([columns]);
    // Intentar soltar "cols" dentro de su propio slot 0 -- debe abortar.
    const result = moveNodeInTree(page, "cols", [0, 0], 0);
    expect(result.moved).toBe(false);
    expect(result.reason).toBe("target-inside-self");
    // El arbol queda exactamente como estaba.
    expect(page.root.map((n) => n.id)).toEqual(["cols"]);
    expect(columns.columnSlots?.[0].map((n) => n.id)).toEqual(["child"]);
  });

  it("devuelve moved=false y reason=not-found si el nodeId no existe en el arbol", () => {
    const page = makePage([node("a"), node("b")]);
    const result = moveNodeInTree(page, "no-existe", [], 0);
    expect(result.moved).toBe(false);
    expect(result.reason).toBe("not-found");
    expect(page.root.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("resolveContainer crea columnSlots vacios sobre la marcha si el nodo destino todavia no los tiene", () => {
    const columns = node("cols");
    const page = makePage([columns]);
    const container = resolveContainer(page, [0, 1]);
    expect(container).toEqual([]);
    expect(columns.columnSlots).toBeTruthy();
    expect(columns.columnSlots?.length).toBeGreaterThanOrEqual(2);
  });
});
