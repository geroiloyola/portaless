// Reescritura de enlaces de los docs (docs-links.mjs) y el shell de /docs/.
// La fuente sigue siendo UNICA (el Markdown de docs/): este test fija que
// NINGUN enlace relativo quede relativo en el sitio (o seria 404), que los docs
// incluidos apunten a rutas del sitio y el resto a GitHub, y que el detalle y
// la landing usen el tema oscuro del ecosistema.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_ENTRIES, docBySlug } from "../../src/lib/docs-nav.mjs";
import { rewriteHref, rewriteMarkdownLinks } from "../../src/lib/docs-links.mjs";

const root = join(__dirname, "../..");

describe("docs-links: rewriteHref", () => {
  it("un doc incluido se traduce a su ruta del sitio", () => {
    expect(rewriteHref("./APW-VECTORS-v1.3.md", "docs/protocol-apw/APW-SPEC-v1.3.md", "/")).toBe("/docs/apw-vectors/");
    expect(rewriteHref("../self-hosting.md", "docs/architecture/ecosystem-boundaries.md", "/")).toBe("/docs/self-hosting/");
  });

  it("conserva el ancla al reescribir", () => {
    expect(rewriteHref("./APW-VECTORS-v1.3.md#casos", "docs/protocol-apw/APW-SPEC-v1.3.md", "/")).toBe("/docs/apw-vectors/#casos");
  });

  it("un archivo que no es doc va a GitHub (blob), no a una ruta del sitio", () => {
    const out = rewriteHref("../ERRATA.md", "docs/protocol-apw/APW-SPEC-v1.3.md", "/");
    expect(out).toBe("https://github.com/geroiloyola/portaless/blob/main/docs/ERRATA.md");
  });

  it("un directorio va a GitHub (tree)", () => {
    const out = rewriteHref("../packages/plugin-sandbox", "docs/a.md", "/");
    expect(out).toBe("https://github.com/geroiloyola/portaless/tree/main/packages/plugin-sandbox");
  });

  it("traduce archivo.ts:712 a un ancla de linea de GitHub", () => {
    expect(rewriteHref("./x.ts:712", "docs/a.md", "/")).toBe(
      "https://github.com/geroiloyola/portaless/blob/main/docs/x.ts#L712",
    );
  });

  it("no toca enlaces absolutos, correo, telefono ni anclas puras", () => {
    expect(rewriteHref("https://x.com/a", "docs/a.md", "/")).toBe("https://x.com/a");
    expect(rewriteHref("mailto:x@y.z", "docs/a.md", "/")).toBe("mailto:x@y.z");
    expect(rewriteHref("#seccion", "docs/a.md", "/")).toBe("#seccion");
    expect(rewriteHref("/absoluta", "docs/a.md", "/")).toBe("/absoluta");
  });

  it("respeta el base de Astro en las rutas del sitio", () => {
    expect(rewriteHref("./APW-VECTORS-v1.3.md", "docs/protocol-apw/APW-SPEC-v1.3.md", "/portaless/")).toBe(
      "/portaless/docs/apw-vectors/",
    );
  });
});

describe("docs-links: ningun enlace relativo queda roto", () => {
  it("TODO enlace relativo de cada doc incluido se resuelve (sitio o GitHub)", () => {
    for (const doc of DOC_ENTRIES) {
      const md = readFileSync(join(root, doc.file), "utf8");
      const links = [...md.matchAll(/\]\((\.\.?\/[^)\s]+)\)/g)].map((m) => m[1]);
      for (const href of links) {
        const out = rewriteHref(href, doc.file, "/");
        expect(out.startsWith("."), `${doc.slug}: ${href} -> ${out}`).toBe(false);
        if (out.startsWith("/docs/")) {
          const slug = out.slice("/docs/".length).split(/[/#]/)[0];
          expect(docBySlug(slug), `${doc.slug}: ${href} apunta a un doc inexistente (${slug})`).toBeTruthy();
        } else {
          expect(out.startsWith("https://github.com/"), `${doc.slug}: ${href} -> ${out}`).toBe(true);
        }
      }
    }
  });

  it("rewriteMarkdownLinks solo toca enlaces relativos", () => {
    const md = "Ver [spec](./APW-SPEC-v1.3.md) y [web](https://x.com) y `code`.";
    const out = rewriteMarkdownLinks(md, "docs/protocol-apw/APW-VECTORS-v1.3.md", "/");
    expect(out).toContain("(/docs/protocol-apw/)");
    expect(out).toContain("(https://x.com)");
  });
});

describe("docs: shell, sidebar y dark mode", () => {
  const detail = readFileSync(join(root, "src/pages/docs/[...slug].astro"), "utf8");
  const landing = readFileSync(join(root, "src/pages/docs/index.astro"), "utf8");
  const sidebar = readFileSync(join(root, "src/components/DocsSidebar.astro"), "utf8");
  const mdRoute = readFileSync(join(root, "src/pages/docs/[...slug].md.ts"), "utf8");

  it("el detalle y la landing usan el tema oscuro del ecosistema", () => {
    expect(detail).toContain("ecosystemPageTheme");
    expect(detail).toContain("pageTheme={pageTheme}");
    expect(landing).toContain("ecosystemPageTheme");
    expect(landing).toContain("pageTheme={pageTheme}");
  });

  it("el sidebar sale de la configuracion explicita y marca el idioma", () => {
    expect(sidebar).toContain("DOC_GROUPS");
    expect(sidebar).toContain("group.title[locale]");
    expect(sidebar).toContain("docs-lang");
    expect(sidebar).toContain("doc.lang");
  });

  it("el detalle anuncia la version markdown (rel alternate, como los posts)", () => {
    expect(detail).toContain("markdownUrl");
  });

  it("la proyeccion .md reescribe los enlaces con la misma funcion", () => {
    expect(mdRoute).toContain("rewriteMarkdownLinks");
  });
});
