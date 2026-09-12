# Ejemplo: Tienda con Medusa/Mercur

Configuración de referencia para un sitio centrado en comercio.

```bash
ENABLE_COMMERCE=true
ENABLE_TRUST_LAYER=true   # recomendado para proteger el catalogo de scraping
```

1. Sigue `docs/COMMERCE_SETUP.md` (raíz del repo) para conectar tu
   instancia de Medusa/Mercur.
2. Usa el skin `tienda.json` del dashboard para priorizar pedidos e
   ingresos sobre el resto de los paneles.
3. Considera activar `packages/commerce-plugin/manifest.json` como
   referencia de las capacidades mínimas que este caso de uso necesita
   declarar, aunque la ejecución real hoy siga en `src/commerce/`.
