# Changelog

## v0.0.2

### Agregado
- **Trust Layer** (`packages/trust-layer/`): modulo opcional de identificacion
  criptografica de agentes de IA (Web Bot Auth), politicas de acceso por tipo
  de uso (`search` / `ai_input` / `ai_train`, alineado con Content Signals de
  Cloudflare), y ledger publico de trazabilidad por agente.
- `functions/_middleware.js`: middleware de Cloudflare Pages que activa el
  Trust Layer via la variable de entorno `ENABLE_TRUST_LAYER`.
- `public/.well-known/portaless-content-policy.example.json`: plantilla del
  manifiesto de politicas de contenido.
- `packages/trust-layer/docs/TRUST_LAYER_SETUP.md`: guia de activacion,
  incluyendo advertencias explicitas sobre el estado incompleto de la
  verificacion criptografica y la ausencia de liquidacion de pagos real en
  este MVP.

### Notas de esta version
- La verificacion criptografica de firmas Web Bot Auth (RFC 9421) esta
  marcada como pendiente (`TODO`) en el codigo — no usar en produccion sin
  completarla.
- No hay integracion de cobro real todavia; el adaptador por defecto es
  "observation-only" (solo registra, no cobra).
- El esquema de claves es agnostico al algoritmo de firma para permitir
  migracion futura a esquemas post-cuanticos (ML-DSA / SLH-DSA).

## v0.0.1
- MVP inicial de Portaless: sitio estatico sobre Astro, blog en Markdown,
  despliegue gratuito via GitHub Pages / Cloudflare Pages, modulo de
  comercio opcional compatible con Medusa/Mercur.
