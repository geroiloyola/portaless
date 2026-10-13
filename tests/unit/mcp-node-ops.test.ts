// packages/mcp-server/src/tools/node-ops.ts -- operaciones puras por nodeId.
// Cubre: insercion en root/hijo/slot, patch superficial de props (incluida
// eliminacion de clave con undefined), borrado, y los errores que NO deben
// recortarse en silencio (index fuera de rango, id inexistente, slot fuera de
// rango). Verifica tambien inmutabilidad: el arbol de entrada queda intacto.

import { describe, it, expect } from "vitest";
import { findNodeLocation, insertNode, updateNodeProps, deleteNode } from "../../packages/mcp-server/src/tools/node-ops";
import type { ElementNode } from "../../packages/atomic-elements/src/types";

function tree(): ElementNode[] {
  return [
    { id: "a", type: "Heading", props: { text: "A" } },
    {
      id: "cols",
      type: "Columns",
      props: {},
      columnSlots: [
        [{ id: "c1", type: "Paragraph", props: { text: "col1" } }],
        [{ id: "c2", type: "Paragraph", props: { text: "col2" } }],
      ],
    },
    { id: "b", type: "Paragraph", props: { text: "B" } },
  ];
}

describe("findNodeLocation", () => {
  it("encuentra un nodo en el root", () => {
    const loc = findNodeLocation(tree(), "b");
    expect(loc?.node.id).toBe("b");
    expect(loc?.index).toBe(2);
  });

  it("encuentra un nodo dentro de un columnSlot", () => {
    const loc = findNodeLocation(tree(), "c2");
    expect(loc?.node.id).toBe("c2");
    expect(loc?.container).toHaveLength(1);
  });

  it("devuelve null para un id inexistente", () => {
    expect(findNodeLocation(tree(), "nope")).toBeNull();
  });
});

describe("insertNode", () => {
  it("inserta en el root en el indice dado", () => {
    const node: ElementNode = { id: "nuevo", type: "Paragraph", props: {} };
    const r = insertNode(tree(), undefined, 1, node);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.root.map((n) => n.id)).toEqual(["a", "nuevo", "cols", "b"]);
    }
  });

  it("inserta dentro de un hijo (children) por parentId", () => {
    const base: ElementNode[] = [{ id: "p", type: "Columns", props: {}, children: [] }];
    const r = insertNode(base, "p", 0, { id: "hijo", type: "Paragraph", props: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root[0].children?.[0].id).toBe("hijo");
  });

  it("inserta en el slot elegido cuando el padre tiene columnSlots", () => {
    const r = insertNode(tree(), "cols", 0, { id: "en-slot-1", type: "Paragraph", props: {} }, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cols = r.root.find((n) => n.id === "cols")!;
      expect(cols.columnSlots?.[1].map((n) => n.id)).toEqual(["en-slot-1", "c2"]);
      expect(cols.columnSlots?.[0]).toHaveLength(1);
    }
  });

  it("ERROR (no recorta) si index esta fuera de rango", () => {
    const r = insertNode(tree(), undefined, 99, { id: "x", type: "Paragraph", props: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fuera de rango/);
  });

  it("ERROR si parentId no existe", () => {
    const r = insertNode(tree(), "fantasma", 0, { id: "x", type: "Paragraph", props: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No existe un nodo/);
  });

  it("ERROR si slotIndex esta fuera de rango", () => {
    const r = insertNode(tree(), "cols", 0, { id: "x", type: "Paragraph", props: {} }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/slotIndex/);
  });

  it("NO muta el arbol de entrada", () => {
    const original = tree();
    const snapshot = JSON.parse(JSON.stringify(original));
    insertNode(original, undefined, 0, { id: "x", type: "Paragraph", props: {} });
    expect(original).toEqual(snapshot);
  });
});

describe("updateNodeProps", () => {
  it("sobreescribe claves provistas y conserva el resto", () => {
    const r = updateNodeProps(tree(), "a", { text: "nuevo", align: "center" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.root.find((n) => n.id === "a")!;
      expect(a.props).toEqual({ text: "nuevo", align: "center" });
    }
  });

  it("elimina la clave cuando el valor es undefined", () => {
    const r = updateNodeProps(tree(), "a", { text: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.root.find((n) => n.id === "a")!;
      expect(a.props).toEqual({});
    }
  });

  it("ERROR si el nodo no existe", () => {
    const r = updateNodeProps(tree(), "fantasma", { text: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No existe un nodo/);
  });

  it("NO muta el arbol de entrada", () => {
    const original = tree();
    const snapshot = JSON.parse(JSON.stringify(original));
    updateNodeProps(original, "a", { text: "x" });
    expect(original).toEqual(snapshot);
  });
});

describe("deleteNode", () => {
  it("elimina un nodo del root", () => {
    const r = deleteNode(tree(), "a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root.map((n) => n.id)).toEqual(["cols", "b"]);
  });

  it("elimina un nodo dentro de un columnSlot", () => {
    const r = deleteNode(tree(), "c1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cols = r.root.find((n) => n.id === "cols")!;
      expect(cols.columnSlots?.[0]).toHaveLength(0);
      expect(cols.columnSlots?.[1]).toHaveLength(1);
    }
  });

  it("ERROR si el nodo no existe", () => {
    const r = deleteNode(tree(), "fantasma");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No existe un nodo/);
  });

  it("NO muta el arbol de entrada", () => {
    const original = tree();
    const snapshot = JSON.parse(JSON.stringify(original));
    deleteNode(original, "a");
    expect(original).toEqual(snapshot);
  });
});
