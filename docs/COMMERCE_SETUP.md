# Activar el módulo de comercio (Medusa / Mercur)

Portaless trata el comercio exactamente como WordPress trata a WooCommerce:
es un módulo opcional que se conecta a un sistema de comercio ya existente,
nunca una reimplementación propia de carrito, checkout o pagos.

## Requisitos previos

Necesitas una instancia de **Medusa** (self-hosted o gestionada) o de
**Mercur** ya funcionando, con al menos:

- Una **Publishable API Key** (se genera desde el panel admin de Medusa).
- Una **región de venta** configurada (define moneda y zona de envío).
- Al menos un producto publicado.

## Pasos

1. Copia el archivo de ejemplo:
   ```bash
   cp src/commerce/config.example.ts src/commerce/config.ts
   ```
2. Edita `src/commerce/config.ts` con la URL de tu tienda, tu
   publishable key y el ID de región.
3. Define la variable de entorno `ENABLE_COMMERCE=true` en tu plataforma
   de despliegue (GitHub Actions o Cloudflare Pages).
4. Vuelve a desplegar. La ruta `/tienda` listará los productos que
   devuelva tu instancia de Medusa/Mercur en tiempo de build.

## Qué SÍ hace este módulo

- Lee el catálogo de productos (título, imagen, precio, descripción) vía
  la Storefront API pública de Medusa/Mercur.
- Genera páginas estáticas de listado y detalle de producto.

## Qué NO hace este módulo (por diseño)

- No procesa pagos.
- No gestiona carrito ni checkout — estos flujos deben ocurrir en tu
  instancia de Medusa/Mercur o en un storefront dedicado; Portaless solo
  necesita enlazar hacia allá desde la página de producto.
- No almacena datos de clientes ni de órdenes.

## Por qué esta separación es intencional

Meter lógica de pagos y checkout dentro del mismo sitio estático que
sirve tu blog reintroduce justamente el problema de acoplamiento que este
proyecto busca evitar (ver el análisis de WooCommerce en el whitepaper de
Portaless). Mantener el comercio como un servicio externo, consumido solo
por su API pública, es lo que permite que `/tienda` se pueda desactivar
por completo sin afectar en nada al resto del sitio.
