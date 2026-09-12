// Tipos mínimos para el subconjunto de la Storefront API de Medusa
// que Portaless efectivamente consume. No pretende ser una definición
// completa del SDK de Medusa, solo lo necesario para listar productos.

export interface MedusaPrice {
  amount: number;
  currency_code: string;
}

export interface MedusaVariant {
  id: string;
  title: string;
  calculated_price?: {
    calculated_amount: number;
    currency_code: string;
  };
}

export interface MedusaProduct {
  id: string;
  title: string;
  description: string | null;
  handle: string;
  thumbnail: string | null;
  variants: MedusaVariant[];
}

export interface MedusaProductListResponse {
  products: MedusaProduct[];
  count: number;
}
