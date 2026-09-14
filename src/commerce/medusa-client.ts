import { sandboxedIsCommerceEnabled, sandboxedFetchProducts, sandboxedFetchProductByHandle, type CommerceConfig } from "../../packages/commerce-plugin/src/host-bridge";
import type { Product } from "./types";

let cachedConfig: CommerceConfig | null | undefined;

async function loadConfig(): Promise<CommerceConfig | null> {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const mod = await import("./config");
    cachedConfig = (mod.commerceConfig ?? mod.default ?? null) as CommerceConfig | null;
  } catch {
    cachedConfig = null;
  }
  return cachedConfig;
}

export async function isCommerceEnabled(): Promise<boolean> {
  const config = await loadConfig();
  return sandboxedIsCommerceEnabled(config);
}

export async function fetchProducts(): Promise<Product[]> {
  const config = await loadConfig();
  if (!config) return [];
  return sandboxedFetchProducts(config) as Promise<Product[]>;
}

export async function fetchProductByHandle(handle: string): Promise<Product | null> {
  const config = await loadConfig();
  if (!config) return null;
  const product = await sandboxedFetchProductByHandle(config, handle);
  return (product ?? null) as Product | null;
}

export function formatPrice(product: Product, currency = "usd"): string {
  const variant = (product as any).variants?.[0];
  const priceEntry = variant?.prices?.find((p: any) => p.currency_code === currency.toLowerCase());
  if (!priceEntry) return "Precio no disponible";
  const amount = priceEntry.amount / 100;
  return new Intl.NumberFormat("es", { style: "currency", currency: currency.toUpperCase() }).format(amount);
}
