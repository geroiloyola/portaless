// Cliente mínimo, sin dependencias externas, para leer el catálogo de
// productos desde la Storefront API de Medusa/Mercur en tiempo de build.
//
// Filosofía: Portaless nunca guarda datos de comercio propios. Este
// archivo solo hace fetch() contra la API pública de tu tienda y
// renderiza lo que devuelve, igual que un plugin de WooCommerce delega
// toda la lógica de negocio al core de WooCommerce/WordPress.

import type { MedusaProductListResponse, MedusaProduct } from "./types";

let cachedConfig: typeof import("./config").commerceConfig | null = null;

async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const mod = await import("./config");
    cachedConfig = mod.commerceConfig;
    return cachedConfig;
  } catch {
    throw new Error(
      "Falta src/commerce/config.ts. Copia config.example.ts a config.ts " +
      "y completa tus credenciales de Medusa/Mercur para activar la tienda."
    );
  }
}

export async function isCommerceEnabled(): Promise<boolean> {
  if (import.meta.env.ENABLE_COMMERCE !== "true") return false;
  try {
    await loadConfig();
    return true;
  } catch {
    return false;
  }
}

export async function fetchProducts(): Promise<MedusaProduct[]> {
  const config = await loadConfig();

  const url = new URL("/store/products", config.storeUrl);
  url.searchParams.set("limit", String(config.pageSize));
  if (config.regionId) url.searchParams.set("region_id", config.regionId);

  const res = await fetch(url.toString(), {
    headers: {
      "x-publishable-api-key": config.publishableKey,
    },
  });

  if (!res.ok) {
    throw new Error(
      `No se pudo conectar con la tienda Medusa/Mercur (${res.status}). ` +
      "Revisa storeUrl y publishableKey en src/commerce/config.ts."
    );
  }

  const data = (await res.json()) as MedusaProductListResponse;
  return data.products ?? [];
}

export async function fetchProductByHandle(handle: string): Promise<MedusaProduct | null> {
  const products = await fetchProducts();
  return products.find((p) => p.handle === handle) ?? null;
}

export function formatPrice(product: MedusaProduct): string {
  const price = product.variants?.[0]?.calculated_price;
  if (!price) return "Consultar precio";
  const amount = price.calculated_amount / 100;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: price.currency_code.toUpperCase(),
  }).format(amount);
}
