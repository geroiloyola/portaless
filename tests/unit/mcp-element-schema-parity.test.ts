// packages/mcp-server/src/tools/element-node-schema.ts -- paridad con
// elementRegistry.
//
// Regresion que este test atrapa: el enum de `type` de las tools de contenido
// estaba hardcodeado y se desincronizaba del registro real. Cuando se agregaron
// Video/FAQ/Testimonial/Form/Gallery a elementRegistry, create_page/update_page
// siguieron en 12 tipos y un agente que compusiera un FAQ valido recibia un
// error de Zod, aunque elementRegistry y PageStore ya lo soportaban. El schema
// ahora se deriva del registro, y estos tests impiden que las copias vuelvan.

import { describe, it, expect } from "vitest";
import { elementRegistry, elementPalette } from "../../packages/atomic-elements/src/elements/registry";
import { ELEMENT_TYPE_LIST, elementNodeSchema } from "../../packages/mcp-server/src/tools/element-node-schema";
import type { ElementType } from "../../packages/atomic-elements/src/types";

const registryTypes = Object.keys(elementRegistry);

function nodeOf(type: ElementType) {
  return { id: `n-${type}`, type, props: {} };
}

describe("elementNodeSchema -- paridad con elementRegistry", () => {
  it("ELEMENT_TYPE_LIST contiene exactamente los tipos del registro (sin duplicados)", () => {
    expect(new Set(ELEMENT_TYPE_LIST)).toEqual(new Set(registryTypes));
    expect(ELEMENT_TYPE_LIST).toHaveLength(registryTypes.length);
  });

  it("elementPalette es una permutacion del registro (mismo conjunto, mismo largo)", () => {
    expect(new Set(elementPalette)).toEqual(new Set(registryTypes));
    expect(elementPalette).toHaveLength(registryTypes.length);
  });

  it("el schema acepta TODOS los tipos del registro", () => {
    for (const type of registryTypes) {
      const result = elementNodeSchema.safeParse(nodeOf(type as ElementType));
      expect(result.success, `el schema rechaza el tipo soportado "${type}"`).toBe(true);
    }
  });

  it("el schema rechaza un tipo inventado que no esta en el registro", () => {
    const result = elementNodeSchema.safeParse({ id: "x", type: "PaywallBoundary", props: {} });
    expect(result.success).toBe(false);
  });

  it("todos los tipos del registro traen la metadata que list_page_components expone", () => {
    for (const type of registryTypes) {
      const def = elementRegistry[type as ElementType];
      expect(typeof def.displayName, `${type}.displayName`).toBe("string");
      expect(typeof def.icon, `${type}.icon`).toBe("string");
      expect(def.defaultProps, `${type}.defaultProps`).toBeTypeOf("object");
      expect(Array.isArray(def.editableProps), `${type}.editableProps`).toBe(true);
    }
  });
});
