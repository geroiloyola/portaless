import type { PageLayout, ElementNode } from "../types";

export interface SiteInfo {
  url: string;
  name: string;
  logoUrl?: string;
  sameAs?: string[];
}

function findNodesOfType(nodes: ElementNode[], type: ElementNode["type"]): ElementNode[] {
  const found: ElementNode[] = [];
  for (const node of nodes) {
    if (node.type === type) found.push(node);
    if (node.children?.length) found.push(...findNodesOfType(node.children, type));
    if (node.columnSlots?.length) {
      for (const slot of node.columnSlots) found.push(...findNodesOfType(slot, type));
    }
  }
  return found;
}

function extractDescription(layout: PageLayout): string {
  if (layout.description) return layout.description;
  const paragraphs = findNodesOfType(layout.root, "Paragraph");
  const firstText = paragraphs[0]?.props?.text as string | undefined;
  return firstText ? firstText.slice(0, 300) : layout.title;
}

export function buildJsonLd(layout: PageLayout, site: SiteInfo): Record<string, unknown> {
  const pageUrl = new URL(layout.slug === "" || layout.slug === "/" ? "/" : `/paginas/${layout.slug}`, site.url).toString();

  const organization = {
    "@type": "Organization",
    "@id": `${site.url}#organization`,
    name: site.name,
    url: site.url,
    ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
  };

  const webPage: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: layout.title,
    description: extractDescription(layout),
    isPartOf: { "@id": `${site.url}#organization` },
    inLanguage: "es",
  };

  const graph: unknown[] = [organization, webPage];

  const productGrids = findNodesOfType(layout.root, "ProductGrid");
  if (productGrids.length > 0) {
    graph.push({
      "@type": "ItemList",
      "@id": `${pageUrl}#productlist`,
      name: `Productos - ${layout.title}`,
      about: { "@id": `${pageUrl}#webpage` },
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

export function buildProductJsonLd(
  product: { title: string; handle: string; thumbnail?: string; description?: string },
  priceText: string,
  currency: string,
  site: SiteInfo
): Record<string, unknown> {
  const productUrl = new URL(`/tienda/${product.handle}`, site.url).toString();
  const numericPrice = parseFloat(priceText.replace(/[^0-9.,]/g, "").replace(",", "."));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    name: product.title,
    description: product.description ?? product.title,
    url: productUrl,
    ...(product.thumbnail ? { image: product.thumbnail } : {}),
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: currency,
      price: Number.isFinite(numericPrice) ? numericPrice : undefined,
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: site.name },
    },
  };
}
