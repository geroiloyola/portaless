import type { PageLayout, ElementNode } from "../types";

/**
 * Vocabulario cerrado de tipos de contenido que un sitio puede declarar
 * que trae -- pensado para que un agente externo que visite
 * /trust/[siteId] (Trust Layer, ver docs/architecture/site-trust-score.md)
 * sepa de antemano que esperar del sitio sin tener que rastrearlo o
 * inferirlo del HTML. No reemplaza a SiteTrustScore: content_kinds
 * declara QUE trae el sitio, no SI es confiable -- son preguntas
 * distintas y complementarias (ver
 * docs/architecture/creator-sites-agentic-workflow.md).
 */
export type ContentKind =
  | "commerce" | "affiliate" | "editorial" | "research" | "social_links" | "community";

export interface SiteInfo {
  url: string;
  name: string;
  logoUrl?: string;
  sameAs?: string[];
  /**
   * Opcional a proposito: un sitio existente que no declare este campo
   * sigue funcionando igual -- buildJsonLd() y el Trust Layer deben
   * tratar un content_kinds ausente como "no declarado", nunca como
   * error. Ver tabla de dependencias en
   * docs/architecture/creator-sites-agentic-workflow.md.
   */
  contentKinds?: ContentKind[];
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
 *
 * REGLA DE DISENO (ver CONTRIBUTING.md en la raiz de este paquete): esta
 * es exactamente el tipo de funcion que debe vivir en el core, nunca en
 * un plugin de presentacion -- cualquier dato que SiteTrustScore vaya a
 * verificar (aqui, agent.structured_data_quality) necesita una fuente
 * que ningun plugin pueda reemplazar silenciosamente.
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
 * v0.0.9.25: el @returns explicito de abajo importa mas de lo habitual
 * en esta funcion especifica -- ANTES de v0.0.9.24 esta funcion era
 * SYNC. Es un cambio de contrato real, no solo de implementacion: un
 * consumidor futuro que copie el patron viejo (`const jsonLd =
 * buildJsonLd(...)` sin await) va a recibir una Promise en vez del
 * objeto JSON-LD, y JSON.stringify() de una Promise no lanza -- serializa
 * silenciosamente un objeto vacio ({}), sin ningun error visible en
 * build ni en runtime. astro-integration/JsonLd.astro (unico consumidor
 * conocido hoy) ya usa `await buildJsonLd(...)`.
 *
 * v0.0.9.26: agrega site.contentKinds (opcional) al @graph como
 * additionalProperty de la Organization cuando esta declarado -- mismo
 * criterio que el resto de este archivo: un campo ausente no cambia el
 * comportamiento, uno presente se refleja literalmente sin inferencia.
 * Ver docs/architecture/creator-sites-agentic-workflow.md.
 *
 * @returns {Promise<Record<string, unknown>>} el objeto JSON-LD completo
 * (@context + @graph) -- SIEMPRE debe consumirse con `await`, nunca
 * usarse el valor de retorno directo de la llamada.
 */
export async function buildJsonLd(layout: PageLayout, site: SiteInfo): Promise<Record<string, unknown>> {
  const pageUrl = new URL(layout.slug === "" || layout.slug === "/" ? "/" : `/paginas/${layout.slug}`, site.url).toString();

  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${site.url}#organization`,
    name: site.name,
    url: site.url,
    ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
    ...(site.contentKinds?.length
      ? {
          additionalProperty: site.contentKinds.map((kind) => ({
            "@type": "PropertyValue",
            name: "contentKind",
            value: kind,
          })),
        }
      : {}),
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
