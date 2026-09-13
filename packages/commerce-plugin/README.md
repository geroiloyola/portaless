# @portaless/commerce-plugin

Cliente de Medusa/Mercur, migrado de correr directo en el build de Astro a ejecutarse dentro del sandbox de plugins (NodeIsolatedVmAdapter).

## Por que

Antes, src/commerce/medusa-client.ts hacia fetch() directo a Medusa desde el mismo proceso que compila todo el sitio. Ahora el fetch real ocurre dentro de un V8 isolate aislado, con red restringida unicamente al host de Medusa configurado.

## Arquitectura

```
src/commerce/medusa-client.ts (contrato publico: isCommerceEnabled, fetchProducts, formatPrice)
  -> packages/commerce-plugin/src/host-bridge.ts (unico punto que conoce config + adaptador)
    -> NodeIsolatedVmAdapter.execute()
      -> packages/commerce-plugin/src/plugin-entry.js (corre AISLADO, solo fetchAllowed())
        -> API de Medusa/Mercur
```

ProductGrid sigue llamando las mismas 3 funciones exactamente igual que antes -- el cambio es transparente para el resto del sitio.

## Requisitos

```
npm install isolated-vm --workspace=@portaless/plugin-sandbox
```

Y src/commerce/config.ts (ver config.example.ts).

## Limitaciones

- formatPrice se mantiene fuera del sandbox (aritmetica pura, sin I/O).
- Cada fetchProducts() crea un nuevo isolate (sin pool reutilizable).
