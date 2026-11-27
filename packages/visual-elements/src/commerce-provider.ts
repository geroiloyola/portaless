// Puerto de catalogo de comercio para Visual Elements (ProductGrid + JSON-LD).
// Evita que packages/visual-elements (L3) importe src/commerce/medusa-client (L5).
// La capa L5 (src/commerce/medusa-client.ts) registra la implementacion real
// al cargarse; en ausencia de proveedor registrado, el comercio se trata como
// desactivado (mismo comportamiento fail-closed).

export interface CommerceCatalogProvider {
  isCommerceEnabled(): Promise<boolean>;
  fetchProducts(): Promise<any[]>;
  formatPrice(product: any, currency?: string): string;
}

let registeredProvider: CommerceCatalogProvider | null = null;

export function registerCommerceCatalogProvider(provider: CommerceCatalogProvider | null): void {
  registeredProvider = provider;
}

export function getCommerceCatalogProvider(): CommerceCatalogProvider | null {
  return registeredProvider;
}
