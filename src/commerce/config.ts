// Configuracion REAL del modulo de comercio, generada desde config.example.ts.
// Este archivo SI se commitea: contiene solo valores vacios por defecto,
// sin credenciales. Con storeUrl vacio, el modulo de comercio queda
// desactivado: el build compila sin intentar ninguna peticion de red y
// ProductGrid renderiza su estado de "comercio desactivado".
//
// Para activar comercio real: copia los valores de tu instancia de
// Medusa/Mercur (ver config.example.ts) y reemplazalos aqui.

export const commerceConfig = {
  // URL publica de tu backend Medusa/Mercur (Storefront API v2).
  // Vacia = modulo de comercio desactivado.
  storeUrl: "",

  // Publishable API Key generada desde el admin de Medusa.
  publishableKey: "",

  // ID de la region de venta configurada en Medusa (define moneda/precios).
  regionId: "",

  // Cuantos productos mostrar en /tienda.
  pageSize: 24,
};
