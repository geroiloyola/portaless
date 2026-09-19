import type { PageLayout, ElementNode } from "../types";

export interface SiteInfo {
  url: string;
  name: string;
  logoUrl?: string;
  sameAs?: string[];
}

const DEFAULT_CURRENCY = "usd"; // mismo default que medusa-client.ts formatPrice()

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

/**
 * Resuelve los productos reales de un nodo ProductGrid (source: "medusa")
 * -- mismo patron exacto que ProductGrid.renderHTMLAsync en
 * elements/registry.ts (import dinamico de medusa-client, isCommerceEnabled,
 * fetchProducts, slice por limit). Se centraliza aqui en vez de duplicar
 * la logica porque buildJsonLd necesita el MISMO subconjunto de productos
 * que el HTML ya muestra -- si alguna vez difieren (ej. limit distinto),
 * el JSON-LD deja de ser coherente con lo que el usuario ve, que es
 * exactamente el problema que agent.structured_data_quality esta pensado
 * para detectar.
 *
 * Nunca lanza: catalogo vacio, comercio desactivado, o error de red
 * devuelven [] -- buildJsonLd simplemente omite el ItemList en esos casos
 * (ver comentario mas abajo sobre por que se omite en vez de emitir uno
 * vacio).
 */
async function resolveProductGridProducts(node: ElementNode): Promise<any[]> {
  const props = node.props as { source?: string; limit?: number } | undefined;
  if (props?.source !== "medusa") return [];

  try {
    const { isCommerceEnabled, fetchProducts } = await import(
      /* @vite-ignore */ "../../../../src/commerce/medusa-client"
    );
    const enabled = await isCommerceEnabled();
    if (!enabled) return [];

    const limit = typeof props.limit === "number" ? props.limit : 6;
    return (await fetchProducts()).slice(0, limit);
  } catch {
    // Mismo criterio que renderHTMLAsync: un error de red/config no debe
    // tumbar la generacion de JSON-LD de toda la pagina -- se omite el
    // listado de productos, no la pagina entera.
    return [];
  }
}

/**
 * Replica exactamente medusa-client.ts formatPrice() (variants[0], prices
 * por currency_code, /100) sin depender de un import dinamico adicional
 * en este archivo -- para que el precio en el JSON-LD coincida con el
 * que ve el usuario en el HTML. Si esta logica cambia en
 * medusa-client.ts, debe cambiar aqui tambien. Usa DEFAULT_CURRENCY
 * ("usd") como fallback -- mismo default que medusa-client.ts; SiteInfo
 * no define un campo currency propio hoy.
 */
function formatPriceForProduct(product: any, currency: string = DEFAULT_CURRENCY): string {
  const variant = product?.variants?.[0];
  const priceEntry = variant?.prices?.find((p: any) => p.currency_code === currency.toLowerCase());
  if (!priceEntry) return "Precio no disponible";
  const amount = priceEntry.amount / 100;
  return new Intl.NumberFormat("es", { style: "currency", currency: currency.toUpperCase() }).format(amount);
}

/**
 * Arma el @graph completo de una pagina, incluyendo el ItemList con sus
 * productos reales si la pagina tiene un ProductGrid con source:"medusa".
 *
 * v0.0.9.24: ahora es ASYNC -- antes devolvia un ItemList sin
 * itemListElement (un contenedor vacio que declaraba "hay una lista de
 * productos aqui" sin listar ninguno), porque resolver los productos
 * reales de Medusa requiere I/O. Un sitio con esto desplegado fallaria
 * su propia verificacion de agent.structured_data_quality -- exactamente
 * el tipo de incoherencia entre "lo que se declara" y "lo que existe"
 * que SiteTrustScore esta diseñado para exponer. Ver
 * docs/architecture/site-trust-score.md.
 *
 * astro-integration/JsonLd.astro (unico consumidor conocido de esta
 * funcion) ya se actualizo con `await buildJsonLd(...)` en el mismo
 * commit -- el frontmatter de Astro soporta await de forma nativa.
 */
export async function buildJsonLd(layout: PageLayout, site: SiteInfo): Promise<Record<string, unknown>> {
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
    // Puede haber mas de un ProductGrid en la misma pagina -- se resuelven
    // en paralelo (son fetches independientes) y cada uno genera su propio
    // ItemList, con @id #productlist-N si hay mas de una grilla (evita
    // colisionar @id dentro del mismo @graph).
    const productsPerGrid = await Promise.all(productGrids.map(resolveProductGridProducts));

    productGrids.forEach((_, gridIndex) => {
      const products = productsPerGrid[gridIndex];

      if (products.length === 0) {
        // Sin productos reales que listar (catalogo vacio, comercio
        // desactivado, o source:"manual") -- se omite el ItemList por
        // completo en vez de emitir uno vacio. Un ItemList sin
        // itemListElement es exactamente la inconsistencia que este
        // commit corrige; omitirlo aqui es preferible a repetir el bug
        // con una lista de longitud 0.
        return;
      }

      const listId = productGrids.length > 1 ? `${pageUrl}#productlist-${gridIndex + 1}` : `${pageUrl}#productlist`;

      const itemListElement = products.map((product: any, index: number) => ({
        "@type": "ListItem",
        position: index + 1,
        item: buildProductJsonLd(product, formatPriceForProduct(product), DEFAULT_CURRENCY, site),
      }));

      graph.push({
        "@type": "ItemList",
        "@id": listId,
        name: `Productos - ${layout.title}`,
        about: { "@id": `${pageUrl}#webpage` },
        numberOfItems: itemListElement.length,
        itemListElement,
      });
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
