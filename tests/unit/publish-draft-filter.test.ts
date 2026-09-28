// v0.0.9.29 -- salvaguarda: nunca publicar un borrador del Wizard sin revisar.
import { describe, it, expect } from "vitest";
import { excludeDrafts } from "../../packages/deploy-engine/src/draft-filter";

describe("excludeDrafts", () => {
  it("excluye por defecto los slugs que terminan en -draft", () => {
    const r = excludeDrafts(["index", "mi-sitio-draft", "blog"], false);
    expect(r.slugs).toEqual(["index", "blog"]);
    expect(r.skipped).toBe(1);
  });

  it("con includeDrafts=true no excluye nada", () => {
    const r = excludeDrafts(["index", "mi-sitio-draft"], true);
    expect(r.slugs).toEqual(["index", "mi-sitio-draft"]);
    expect(r.skipped).toBe(0);
  });

  it("no excluye slugs que solo contienen 'draft' en otra posicion", () => {
    const r = excludeDrafts(["draft-notes", "borrador"], false);
    expect(r.slugs).toEqual(["draft-notes", "borrador"]);
    expect(r.skipped).toBe(0);
  });

  it("no excluye nada si la lista esta vacia", () => {
    const r = excludeDrafts([], false);
    expect(r.slugs).toEqual([]);
    expect(r.skipped).toBe(0);
  });
});
