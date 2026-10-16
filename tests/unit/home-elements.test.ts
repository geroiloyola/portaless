// Icon, FeatureGrid y PostList -- los tres elementos nuevos del home de
// Portaless (docs/design/home-redesign.md, Fase 1 y 2). Cubre: resolucion
// fail-safe del nombre de icono, parsing de la grilla ("icono :: titulo ::
// texto"), columnas, y la lista de publicaciones (datos inyectados en build,
// limite, estado vacio honesto, y escape de XSS en todos).
import { describe, it, expect } from "vitest";
import { elementRegistry, elementPalette } from "../../packages/atomic-elements/src/elements/registry";
import { CONTENT_ICON_NAMES } from "../../packages/atomic-elements/src/elements/icons";

describe("Icon", () => {
  it("renderiza el SVG del nombre pedido, con currentColor y caja de 24px", () => {
    const html = elementRegistry.Icon.renderHTML({ name: "shield" } as never);
    expect(html).toContain('class="ae-icon"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain("width:24px;height:24px");
    expect(html).toContain("<svg");
  });

  it("nombre desconocido cae al default (sparkles), nunca rompe", () => {
    const html = elementRegistry.Icon.renderHTML({ name: "no-existe-este-icono" } as never);
    expect(html).toContain("<svg");
    expect(html).toContain('class="ae-icon"');
  });

  it("todos los nombres de CONTENT_ICON_NAMES renderizan un svg", () => {
    for (const name of CONTENT_ICON_NAMES) {
      const html = elementRegistry.Icon.renderHTML({ name } as never);
      expect(html, name).toContain("<svg");
    }
  });
});

describe("FeatureGrid", () => {
  it("parsea items 'icono :: titulo :: texto' en tarjetas", () => {
    const html = elementRegistry.FeatureGrid.renderHTML({
      title: "Pilares",
      columns: 3,
      items: "shield :: Soberania :: Vos sos dueno del estado.\nkey :: Identidad :: Una llave, no una cuenta.",
    } as never);
    expect(html).toContain('class="ae-feature-grid"');
    expect(html).toContain("Soberania");
    expect(html).toContain("Vos sos dueno del estado.");
    expect(html).toContain("Identidad");
    expect(html).toContain("<svg"); // los iconos
    expect(html).toContain("grid-template-columns:repeat(3,1fr)");
  });

  it("respeta columnas 2 y 4", () => {
    const two = elementRegistry.FeatureGrid.renderHTML({ title: "", columns: 2, items: "check :: A :: b" } as never);
    expect(two).toContain("repeat(2,1fr)");
    const four = elementRegistry.FeatureGrid.renderHTML({ title: "", columns: 4, items: "check :: A :: b" } as never);
    expect(four).toContain("repeat(4,1fr)");
  });

  it("sin items muestra el estado vacio honesto (no una grilla rota)", () => {
    const html = elementRegistry.FeatureGrid.renderHTML({ title: "", columns: 3, items: "" } as never);
    expect(html).toContain("Agrega items en el panel");
  });

  it("escapa titulo y texto (XSS)", () => {
    const html = elementRegistry.FeatureGrid.renderHTML({
      title: "",
      columns: 3,
      items: 'check :: <script>x</script> :: <img src=x onerror=y>',
    } as never);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("PostList", () => {
  const items = [
    { title: "Uno", href: "/blog/uno/", date: "2026-10-01", description: "Primero" },
    { title: "Dos", href: "/blog/dos/", date: "2026-09-01", description: "Segundo" },
    { title: "Tres", href: "/blog/tres/", date: "2026-08-01" },
  ];

  it("renderiza las publicaciones inyectadas, enlazadas a su HTML", () => {
    const html = elementRegistry.PostList.renderHTML({ title: "Ultimas", limit: 3, items } as never);
    expect(html).toContain('href="/blog/uno/"');
    expect(html).toContain('href="/blog/dos/"');
    expect(html).toContain("Uno");
    expect(html).toContain("Primero");
  });

  it("respeta el limite", () => {
    const html = elementRegistry.PostList.renderHTML({ title: "", limit: 2, items } as never);
    expect(html).toContain("Uno");
    expect(html).toContain("Dos");
    expect(html).not.toContain("Tres");
  });

  it("sin datos (build sin posts) muestra estado vacio honesto, no una lista rota", () => {
    const html = elementRegistry.PostList.renderHTML({ title: "Ultimas", limit: 3 } as never);
    expect(html).toContain("se llena en el build");
    expect(html).not.toContain("<a ");
  });

  it("escapa el titulo (XSS)", () => {
    const html = elementRegistry.PostList.renderHTML({
      title: "",
      limit: 3,
      items: [{ title: "<script>x</script>", href: "/blog/x/" }],
    } as never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("los tres elementos estan en el palette y el registro", () => {
  it("Icon, FeatureGrid y PostList estan registrados y en el palette", () => {
    for (const t of ["Icon", "FeatureGrid", "PostList"] as const) {
      expect(elementRegistry[t]).toBeDefined();
      expect(elementPalette).toContain(t);
    }
  });
});
