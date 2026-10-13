// EditorHistory (editor undo/redo) — logica pura sin DOM, 0% de cobertura.
// Cubre: clone profundo (el historial nunca comparte referencias con el
// layout vivo), push/undo/redo, el vaciado de future al hacer push nuevo,
// el tope de MAX_HISTORY_SIZE=100 (shift del mas viejo), y los null de
// undo/redo sin historial.

import { describe, it, expect } from "vitest";
import { EditorHistory } from "../../packages/atomic-elements/src/editor/history";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

function layout(title: string): PageLayout {
  return { version: "0.1", slug: "p", title, root: [] };
}

describe("EditorHistory", () => {
  it("clone es profundo: mutar el layout original no toca el historial", () => {
    const original = layout("v1");
    original.root.push({ id: "a", type: "Heading", props: { text: "x" } });
    const history = new EditorHistory(original);
    original.root[0].props.text = "MUTADO";
    expect(history.getCurrent().root[0].props.text).toBe("x");
  });

  it("push/undo/redo recorre versiones y getCurrent devuelve clones", () => {
    const history = new EditorHistory(layout("v1"));
    history.push(layout("v2"));
    history.push(layout("v3"));
    expect(history.getCurrent().title).toBe("v3");
    expect(history.undo()?.title).toBe("v2");
    expect(history.redo()?.title).toBe("v3");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("el clone de undo no comparte referencia con el interno (mutar el retorno no corrompe)", () => {
    const history = new EditorHistory(layout("v1"));
    history.push(layout("v2"));
    const undone = history.undo()!;
    undone.title = "MUTADO";
    expect(history.getCurrent().title).toBe("v1");
  });

  it("push limpia el future (rama nueva invalida el redo)", () => {
    const history = new EditorHistory(layout("v1"));
    history.push(layout("v2"));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.push(layout("rama-nueva"));
    expect(history.canRedo).toBe(false);
    expect(history.getCurrent().title).toBe("rama-nueva");
  });

  it("undo sin historial devuelve null, igual que redo sin future", () => {
    const history = new EditorHistory(layout("v1"));
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it("MAX_HISTORY_SIZE=100: el push 101+ descarta el estado mas viejo", () => {
    const history = new EditorHistory(layout("base"));
    for (let i = 1; i <= 120; i++) history.push(layout(`v${i}`));
    // 120 pushes dejan exactamente 100 en el pasado: [v20..v119] con
    // current=v120 (base y v1..v19 fueron descartados por el shift).
    let title = history.getCurrent().title;
    let undos = 0;
    while (history.undo()) {
      title = history.getCurrent().title;
      undos++;
    }
    expect(undos).toBe(100);
    expect(title).toBe("v20");
  });
});
