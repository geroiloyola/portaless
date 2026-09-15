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
- ~~Cada fetchProducts() crea un nuevo isolate (sin pool reutilizable).~~ Resuelto en v0.0.9: host-bridge.ts configura `poolMaxIsolates: 4` (constante `COMMERCE_POOL_MAX_ISOLATES`) al construir el `NodeIsolatedVmAdapter`, asi que hasta 4 isolates V8 se reutilizan entre llamadas a fetchProducts() en vez de crear uno nuevo por invocacion -- cada ejecucion sigue recibiendo un Context nuevo (aislamiento real preservado), solo el isolate subyacente se comparte. Ver packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md y tests/e2e/sandbox-isolate-pool.test.ts para el detalle del pool.
