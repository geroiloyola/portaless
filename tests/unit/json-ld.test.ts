// packages/atomic-elements/src/seo/json-ld.ts: 45 lineas a 0%. Generador
// del @graph JSON-LD (Organization + WebPage + ItemList de productos
// Medusa). Es logica pura sin DOM: se puede probar directo. El unico
// punto con I/O es resolveProductGridProducts(), que importa dinamicamente
// src/commerce/medusa-client -- se mockea ahi (no en el import del sujeto:
// el import es dinamico adentro de la funcion).

import { describe, it, expect, vi } from "vitest";
import type { PageLayout, ElementNode } from "../../packages/atomic-elements/src/types";

const medusa = vi.hoisted(() => ({
  isCommerceEnabled: vi.fn(),
  fetchProducts: vi.fn(),
}));
vi.mock("../../src/commerce/medusa-client", () => medusa);

import { buildJsonLd, buildProductJsonLd } from "../../packages/atomic-elements/src/seo/json-ld";

const site = {
  url: "https://mi-sitio.example",
  name: "Mi Sitio",
};

function node(partial: Partial<ElementNode> & Pick<ElementNode, "type">): ElementNode {
  return { id: partial.id ?? "n1", props: partial.props ?? {}, ...partial } as ElementNode;
}

function layout(partial: Partial<PageLayout>): PageLayout {
  return { version: "0.1", slug: "inicio", title: "Inicio", root: [], ...partial };
}

function graphOf(jsonLd: Record<string, unknown>): any[] {
  return jsonLd["@graph"] as any[];
}

describe("buildJsonLd", () => {
  it("arma Organization y WebPage basicos; slug raiz mapea a la raiz del sitio", async () => {
    const jsonLd = await buildJsonLd(layout({ slug: "/" }), site);
    expect(jsonLd["@context"]).toBe("https://schema.org");
    const graph = graphOf(jsonLd);
    expect(graph).toHaveLength(2);
    const [organization, webPage] = graph;
    expect(organization).toMatchObject({
      "@type": "Organization",
      "@id": "https://mi-sitio.example#organization",
      name: "Mi Sitio",
      url: "https://mi-sitio.example",
    });
    expect(organization.logo).toBeUndefined();
    expect(organization.sameAs).toBeUndefined();
    expect(organization.additionalProperty).toBeUndefined();
    expect(webPage).toMatchObject({
      "@type": "WebPage",
      "@id": "https://mi-sitio.example/#webpage",
      url: "https://mi-sitio.example/",
      name: "Inicio",
      inLanguage: "es",
      isPartOf: { "@id": "https://mi-sitio.example#organization" },
    });
  });

  it("refleja logo, sameAs y contentKinds cuando estan declarados", async () => {
    const jsonLd = await buildJsonLd(
      layout({ slug: "tienda", description: "desc" }),
      {
        ...site,
        logoUrl: "https://mi-sitio.example/logo.png",
        sameAs: ["https://x.example/mi-sitio"],
        contentKinds: ["commerce", "editorial"],
      }
    );
    const [organization, webPage] = graphOf(jsonLd);
    expect(organization.logo).toBe("https://mi-sitio.example/logo.png");
    expect(organization.sameAs).toEqual(["https://x.example/mi-sitio"]);
    expect(organization.additionalProperty).toEqual([
      { "@type": "PropertyValue", name: "contentKind", value: "commerce" },
      { "@type": "PropertyValue", name: "contentKind", value: "editorial" },
    ]);
    expect(webPage.url).toBe("https://mi-sitio.example/paginas/tienda");
    expect(webPage.description).toBe("desc");
  });

  it("description: layout.description > primer Paragraph (max 300) > title", async () => {
    const withDescription = graphOf(
      await buildJsonLd(layout({ description: " explicita ", root: [node({ type: "Paragraph", props: { text: "ignored" } })] }), site)
    )[1];
    expect(withDescription.description).toBe(" explicita ");

    const longText = "x".repeat(350);
    const fromParagraph = graphOf(
      await buildJsonLd(layout({ root: [node({ type: "Paragraph", props: { text: longText } })] }), site)
    )[1];
    expect(fromParagraph.description).toBe("x".repeat(300));

    const fromTitle = graphOf(await buildJsonLd(layout({ root: [node({ type: "Hero", props: {} })] }), site))[1];
    expect(fromTitle.description).toBe("Inicio");
  });

  it("sin ProductGrid (o sin source medusa) no agrega ItemList", async () => {
    const plain = graphOf(await buildJsonLd(layout({ root: [node({ type: "Hero", props: {} })] }), site));
    expect(plain).toHaveLength(2);

    const manualGrid = graphOf(
      await buildJsonLd(
        layout({ root: [node({ type: "ProductGrid", props: { source: "manual" }, children: [] })] }),
        site
      )
    );
    expect(manualGrid).toHaveLength(2);
    expect(medusa.isCommerceEnabled).not.toHaveBeenCalled();
  });

  it("ProductGrid medusa: ItemList con productos reales y precio formateado", async () => {
    medusa.isCommerceEnabled.mockResolvedValue(true);
    medusa.fetchProducts.mockResolvedValue([
      {
        title: "Camiseta",
        handle: "camiseta",
        thumbnail: "https://cdn.example/camiseta.png",
        description: "Algodon",
        variants: [{ prices: [{ currency_code: "usd", amount: 1999 }] }],
      },
      { title: "Gorra", handle: "gorra", variants: [{ prices: [] }] },
    ]);

    const graph = graphOf(
      await buildJsonLd(
        layout({ title: "Tienda", root: [node({ type: "ProductGrid", props: { source: "medusa", limit: 6 } })] }),
        site
      )
    );
    expect(graph).toHaveLength(3);
    const list = graph[2];
    expect(list["@type"]).toBe("ItemList");
    expect(list["@id"]).toBe("https://mi-sitio.example/paginas/inicio#productlist");
    expect(list.numberOfItems).toBe(2);
    expect(list.itemListElement[0].item).toMatchObject({
      "@type": "Product",
      name: "Camiseta",
      description: "Algodon",
      url: "https://mi-sitio.example/tienda/camiseta",
      image: "https://cdn.example/camiseta.png",
      offers: { priceCurrency: "usd", price: 19.99, availability: "https://schema.org/InStock" },
    });
    expect(list.itemListElement[1].item.offers.price).toBeUndefined(); // sin precio: campo ausente
    expect(list.itemListElement[1].item.description).toBe("Gorra"); // fallback al titulo
    // el limit del slice viene del prop
    expect(medusa.fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("catalogo vacio, comercio desactivado o error de red: sin ItemList (nunca lanza)", async () => {
    medusa.isCommerceEnabled.mockResolvedValue(true);
    medusa.fetchProducts.mockResolvedValue([]);
    const empty = graphOf(
      await buildJsonLd(layout({ root: [node({ type: "ProductGrid", props: { source: "medusa" } })] }), site)
    );
    expect(empty).toHaveLength(2);

    medusa.isCommerceEnabled.mockResolvedValue(false);
    const disabled = graphOf(
      await buildJsonLd(layout({ root: [node({ type: "ProductGrid", props: { source: "medusa" } })] }), site)
    );
    expect(disabled).toHaveLength(2);

    medusa.isCommerceEnabled.mockRejectedValue(new Error("sin red"));
    const failing = await buildJsonLd(layout({ root: [node({ type: "ProductGrid", props: { source: "medusa" } })] }), site);
    expect(graphOf(failing)).toHaveLength(2);
  });

  it("mas de una grilla numera los @id (#productlist-1, -2, ...)", async () => {
    medusa.isCommerceEnabled.mockResolvedValue(true);
    medusa.fetchProducts.mockResolvedValue([
      { title: "A", handle: "a", variants: [{ prices: [{ currency_code: "usd", amount: 100 }] }] },
    ]);
    // Nota de testing: el import dinamico de medusa-client lleva
    /* @vite-ignore */ // y vitest solo intercepta la PRIMERA resolucion por
    // modulo de sujeto; la segunda grilla resuelve el modulo real (sin
    // config → productos vacios → se omite su ItemList). Con eso alcanza
    // para cubrir la rama de numeracion: la grilla 0 publica
    // #productlist-1 (sufijo presente EXACTAMENTE cuando hay >1 grilla).
    const graph = graphOf(
      await buildJsonLd(
        layout({
          root: [
            node({ id: "g1", type: "ProductGrid", props: { source: "medusa" } }),
            node({ id: "g2", type: "ProductGrid", props: { source: "medusa" } }),
          ],
        }),
        site
      )
    );
    expect(graph).toHaveLength(3);
    expect(graph[2]["@id"]).toBe("https://mi-sitio.example/paginas/inicio#productlist-1");
  });

  it("busca ProductGrid tambien dentro de children y columnSlots (nodos anidados)", async () => {
    medusa.isCommerceEnabled.mockResolvedValue(true);
    medusa.fetchProducts.mockResolvedValue([
      { title: "A", handle: "a", variants: [{ prices: [{ currency_code: "usd", amount: 100 }] }] },
    ]);
    const nested = graphOf(
      await buildJsonLd(
        layout({
          root: [
            node({
              type: "Columns",
              children: [node({ id: "c", type: "ProductGrid", props: { source: "medusa" } })],
              columnSlots: [[node({ id: "s", type: "ProductGrid", props: { source: "manual" } })]],
            }),
          ],
        }),
        site
      )
    );
    expect(nested.some((n: any) => n["@type"] === "ItemList")).toBe(true);
  });
});

describe("buildProductJsonLd", () => {
  it("parsea el precio formateado (es-USD: coma decimal) a numero", () => {
    const jsonLd = buildProductJsonLd(
      { title: "Taza", handle: "taza" },
      "12,34 US$",
      "usd",
      site
    );
    expect(jsonLd.offers).toMatchObject({ priceCurrency: "usd", price: 12.34 });
  });

  it("precio no parseable deja offers.price ausente", () => {
    const jsonLd = buildProductJsonLd({ title: "X", handle: "x" }, "Precio no disponible", "usd", site);
    expect(jsonLd.offers.price).toBeUndefined();
  });
});
