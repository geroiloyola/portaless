// Configuracion del sidebar de /docs/ (docs-nav.mjs): es una lista EXPLICITA
// (grupo -> orden), no el orden de archivos. Este test fija que sea coherente:
// slugs unicos, archivos que existen, idioma declarado, y titulos en los dos
// idiomas de grupo.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_GROUPS, DOC_ENTRIES, DOC_FILES, docBySlug } from "../../src/lib/docs-nav.mjs";

const root = join(__dirname, "../..");

describe("docs-nav: configuracion del sidebar", () => {
  it("hay 4 grupos (Getting started, Guides, Reference, Concepts)", () => {
    expect(DOC_GROUPS.map((g) => g.id)).toEqual(["getting-started", "guides", "reference", "concepts"]);
  });

  it("cada grupo tiene titulo en ingles y español", () => {
    for (const g of DOC_GROUPS) {
      expect(typeof g.title.en, g.id).toBe("string");
      expect(typeof g.title.es, g.id).toBe("string");
      expect(g.title.en.length, g.id).toBeGreaterThan(0);
      expect(g.title.es.length, g.id).toBeGreaterThan(0);
    }
  });

  it("los slugs son unicos y no vacios", () => {
    const slugs = DOC_ENTRIES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it("cada doc apunta a un archivo que EXISTE en el repo", () => {
    for (const doc of DOC_ENTRIES) {
      expect(existsSync(join(root, doc.file)), doc.file).toBe(true);
    }
  });

  it("cada doc declara su idioma (en | es)", () => {
    for (const doc of DOC_ENTRIES) expect(["en", "es"], doc.slug).toContain(doc.lang);
  });

  it("DOC_FILES es el patron del loader (paths relativos a docs/)", () => {
    expect(DOC_FILES).toEqual(DOC_ENTRIES.map((d) => d.file.replace(/^docs\//, "")));
    for (const f of DOC_FILES) expect(f.startsWith("docs/"), f).toBe(false);
  });

  it("docBySlug resuelve, y no inventa", () => {
    expect(docBySlug("vision")?.file).toBe("docs/VISION.md");
    expect(docBySlug("no-existe")).toBeUndefined();
  });

  it("no incluye documentos excluidos (roadmap archive, roadmap_es, internos)", () => {
    const files = DOC_ENTRIES.map((d) => d.file).join("\n");
    expect(files).not.toContain("ROADMAP-ARCHIVE");
    expect(files).not.toContain("ROADMAP_es");
    expect(files).not.toContain("_es.md"); // archivos de archivo en español
    expect(files).not.toContain("v0.0.9.30-estado");
  });
});
