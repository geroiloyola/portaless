

## Trust Layer (nuevo en v0.0.2, opcional)

Portaless incluye ahora un módulo opcional que identifica criptográficamente
a agentes de IA que visitan tu sitio (vía el estándar en desarrollo del IETF
**Web Bot Auth**), aplica políticas de acceso por tipo de uso (compatibles
con **Content Signals** de Cloudflare: `search`, `ai_input`, `ai_train`), y
publica un ledger público de trazabilidad por agente — pensado como
evidencia verificable ante un eventual reclamo legal por scraping no
autorizado.

Ver `packages/trust-layer/docs/TRUST_LAYER_SETUP.md` para activarlo y, muy
importante, las advertencias sobre qué partes de la verificación
criptográfica y de la liquidación de pagos **todavía no están implementadas**
en este MVP (quedan marcadas como `TODO` explícito en el código).

Este módulo, igual que el de comercio, es 100% opcional: si no defines
`ENABLE_TRUST_LAYER=true`, tu sitio funciona exactamente igual que en v0.0.1,
sin ninguna latencia ni lógica adicional.
