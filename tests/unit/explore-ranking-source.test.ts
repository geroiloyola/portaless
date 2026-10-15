// Explore declara su fuente y su estado degradado (Fase 9a). En hosting
// estatico no hay nodo: la UI no debe fingir un ranking por testigos. Este
// test fija esa promesa a nivel de fuente.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "..", "src", "pages", "explore.astro"), "utf8");

describe("Explore: estado degradado honesto", () => {
  it("declara la fuente local y el instante/ventana", () => {
    expect(src).toContain('data-explore-source="local"');
    expect(src).toContain("asOf:");
    expect(src).toContain("Ventana:");
  });

  it("ofrece los seis filtros normativos", () => {
    for (const f of ["top", "confidence", "recents", "new", "old", "history"]) {
      expect(src, f).toContain(`"${f}"`);
    }
  });

  it("explica que el ranking por testigos requiere un nodo con functions/", () => {
    expect(src).toContain("functions/");
  });

  it("mantiene el filtro de publicacion canonico (no muestra borradores)", () => {
    expect(src).toContain("draft-filter");
    expect(src).toContain("isDraft");
  });
});
