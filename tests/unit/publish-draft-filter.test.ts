// v0.0.9.29 -- salvaguarda: nunca publicar un borrador del Wizard sin revisar.
// v0.0.9.10 -- se agrega excludeDraftPages, que ademas del sufijo legacy
// "-draft" excluye los PageLayout con status:"draft" nativo (PageLayout.status).
import { describe, it, expect } from "vitest";
import { excludeDrafts, excludeDraftPages, isDraft } from "../../packages/deploy-engine/src/draft-filter";

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

describe("isDraft", () => {
  it("true para slug con sufijo -draft (legacy)", () => {
    expect(isDraft({ slug: "mi-pagina-draft" })).toBe(true);
  });

  it("true para status 'draft' nativo", () => {
    expect(isDraft({ slug: "mi-pagina", status: "draft" })).toBe(true);
  });

  it("false para status 'published'", () => {
    expect(isDraft({ slug: "mi-pagina", status: "published" })).toBe(false);
  });

  it("false para pagina sin status y sin sufijo (layout legacy ya publicado)", () => {
    expect(isDraft({ slug: "mi-pagina" })).toBe(false);
  });
});

describe("excludeDraftPages (status-aware, la que usa publish-site.mjs)", () => {
  it("excluye por sufijo legacy -draft y por status 'draft'", () => {
    const pages = [
      { slug: "index", status: "published" },
      { slug: "borrador-viejo-draft" },
      { slug: "borrador-nuevo", status: "draft" },
      { slug: "blog", status: "published" },
    ];
    const r = excludeDraftPages(pages, false);
    expect(r.pages.map((p) => p.slug)).toEqual(["index", "blog"]);
    expect(r.skipped).toBe(2);
  });

  it("con includeDrafts=true no excluye nada", () => {
    const pages = [
      { slug: "index", status: "published" },
      { slug: "borrador-nuevo", status: "draft" },
    ];
    const r = excludeDraftPages(pages, true);
    expect(r.pages).toHaveLength(2);
    expect(r.skipped).toBe(0);
  });

  it("trata un layout legacy sin status como publicado", () => {
    const pages = [{ slug: "contacto" }];
    const r = excludeDraftPages(pages, false);
    expect(r.pages.map((p) => p.slug)).toEqual(["contacto"]);
    expect(r.skipped).toBe(0);
  });
});
