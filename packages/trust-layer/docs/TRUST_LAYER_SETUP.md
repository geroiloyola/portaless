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
3. Con `ENABLE_TRUST_LAYER=true`, `functions/_middleware.js` intercepta cada
   request. Aplica **`ai_input`** a las peticiones de agentes (allow, 402 o
   403). `search` y `ai_train` se publican en `robots.txt` (`Content-Signal`) y
   en el manifiesto, pero son señales cooperativas: el middleware no bloquea
   por ellas. El panel `/admin/agents` muestra `enforced=false` cuando el flag
   esta apagado.

## Precedencia: panel > archivo > por defecto

Desde la fase 12 de [`ROADMAP.md`](../../../ROADMAP.md) la politica tambien se
puede editar **desde el panel**, sin editar un archivo ni redesplegar:

| Capa | Que es | Donde se cambia |
|---|---|---|
| `store` | Override del dueno | `/admin/agents` -> Guardar politica |
| `asset` | El archivo del sitio | `public/.well-known/portaless-content-policy.json` |
| `default` | `defaultContentPolicy()` | -- |

Precedencia: **store > asset > default**. Cada capa cae a la siguiente si no
existe o es invalida; nunca se aplica una politica a medias. El panel muestra
de que capa sale el valor efectivo, porque el problema que esta fase resuelve es
justo no poder confirmar si el cambio surtio efecto.

Detalles que conviene saber antes de cambiar una regla:

- **Guardar un precio no activa el cobro.** `ai_input: "charge"` sin un
  proveedor de pago verificado en `/admin/settlement` hace que el agente reciba
  `402` con `settlement: "not_available"`. El panel lo dice en la misma pagina.
- **El store se lee en cada peticion de agente, sin cache.** Un `block` guardado
  desde el panel tiene que aplicar en la peticion siguiente; un retardo de
  enforcement seria un fallo de privacidad, no una optimizacion.
- **El override se puede borrar** con "Restaurar el valor del archivo" (DELETE
  `/admin/api/agents`), que devuelve el sitio al asset o al default.
- Esto **no** cambia quien puede reportar sobre el sitio en el Site Trust Score:
  eso lo decide la allowlist de `/admin/authorized-agents`.

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

**Actualizado v0.0.9.3**: el ledger ya persiste en D1 (Cloudflare) o SQLite
(self-hosted) por defecto -- `createUsageLedgerStore(env)` en
`packages/trust-layer/src/ledger/store-factory.ts` resuelve `env.DB` (D1) o
`env.PORTALESS_SQLITE_PATH` (self-hosted), y solo cae a
`InMemoryUsageLedgerStore` (se reinicia con cada despliegue) si ninguno de
los dos esta configurado -- util para probar localmente, pero no
recomendado en produccion.

La escritura ocurre automaticamente: `functions/_middleware.js` llama a
`recordAgentAccess()` en cada request de un agente detectado (desde
v0.0.6). La lectura publica se expone en:

```
GET /.well-known/portaless-usage-log.json
GET /.well-known/portaless-usage-log.json?period=2026-03
```

Sin autenticacion -- es informacion agregada y no sensible (contadores por
operador, nunca contenido de las requests), publicada a proposito para que
cualquiera pueda auditar el comportamiento del sitio con agentes de IA,
igual que un panel de uso por modelo de OpenRouter. Sin `?period`, devuelve
el mes UTC actual; un mes sin trafico responde `200` con `agents: []` (no
`404`). Implementacion en
`functions/.well-known/portaless-usage-log.json.js`.
