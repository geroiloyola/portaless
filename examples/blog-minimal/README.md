# Ejemplo: Blog Mínimo

Configuración de referencia para usar Portaless como blog simple, sin
comercio ni Trust Layer activados.

```bash
# Variables de entorno recomendadas para este caso de uso
ENABLE_COMMERCE=false
ENABLE_TRUST_LAYER=false
```

Usa el skin `blog.json` del dashboard (`packages/dashboard/src/skins/blog.json`)
para priorizar el panel de contenido sobre cualquier otro módulo.
