# Portaless Trust Layer — Guia de Activacion (v0.0.2)

Modulo opcional que identifica criptograficamente agentes de IA (Web Bot Auth),
aplica politicas de acceso por tipo de uso (Content Signals) y publica un
ledger de trazabilidad estilo OpenRouter. Ver el documento
`Portaless_Trust_Layer.md` del proyecto para el diseño completo y su
justificacion.

## Activacion

1. En tu proyecto de Cloudflare Pages (o el equivalente si usas GitHub Pages
   con un Worker aparte), define la variable de entorno:
   ```
   ENABLE_TRUST_LAYER=true
   ```
2. Copia `public/.well-known/portaless-content-policy.example.json` a
   `public/.well-known/portaless-content-policy.json` y ajusta:
   - `site`: la URL real de tu sitio.
   - `policies.ai_input.price_usd`: cuanto cobras por acceso de agentes en
     tiempo real (RAG, respuestas generativas).
   - `policies.ai_train`: deja `"access": "block"` si no quieres que tu
     contenido se use para entrenar modelos.
   - `free_for`: dominios de operadores exentos (archivos, ONGs, buscadores
     que consideres beneficiosos).
3. El archivo `functions/_middleware.js` ya intercepta cada request y aplica
   estas politicas automaticamente en Cloudflare Pages.

## Importante: estado de la verificacion criptografica en este MVP

`packages/trust-layer/src/webbotauth/verify.ts` **no implementa todavia** la
verificacion criptografica completa de la firma segun RFC 9421. Resuelve el
directorio de claves del operador y confirma que los headers requeridos
estan presentes, pero el paso de validar matematicamente la firma contra la
clave publica queda marcado como TODO explicito en el codigo. No despliegues
este modulo asumiendo proteccion criptografica real hasta completar ese paso
con una libreria de HTTP Message Signatures auditada.

## Importante: sin liquidacion de pagos real todavia

`packages/trust-layer/src/billing/settlement-adapter.ts` incluye un
adaptador de Cloudflare Pay per Crawl sin implementar (placeholder) y un
adaptador "observation-only" que solo registra en el ledger sin cobrar.
Usa el modo de observacion mientras validas el comportamiento del sistema
con trafico real, antes de activar cobros efectivos.

## Brecha post-cuantica

El estandar Web Bot Auth usa hoy Ed25519 (no post-cuantico). El tipo
`SignatureAlgorithm` en `key-directory.ts` ya declara valores para ML-DSA y
SLH-DSA (estandares post-cuanticos del NIST, FIPS 204/205) para permitir
una migracion futura sin rediseñar el esquema, pero ningun proveedor de
Web Bot Auth en produccion los soporta todavia a la fecha de este MVP.

## Ledger publico

Por defecto, este MVP usa `InMemoryUsageLedgerStore`, que se reinicia con
cada despliegue. Para un ledger persistente real, implementa la interfaz
`UsageLedgerStore` sobre Cloudflare KV, D1 o Durable Objects antes de
publicar el ledger como fuente confiable de trazabilidad.
