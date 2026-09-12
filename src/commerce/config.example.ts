// Copia este archivo a "config.ts" para activar el módulo de comercio.
// Portaless NO reimplementa carrito, checkout ni pagos: solo lee catálogo
// desde una instancia de Medusa o Mercur ya existente, vía su Storefront API.

export const commerceConfig = {
  // URL pública de tu backend Medusa/Mercur (Storefront API v2).
  storeUrl: "https://tu-tienda-medusa.ejemplo.com",

  // Publishable API Key generada desde el admin de Medusa.
  publishableKey: "pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  // ID de la región de venta configurada en Medusa (define moneda/precios).
  regionId: "reg_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  // Cuántos productos mostrar en /tienda.
  pageSize: 24,
};
