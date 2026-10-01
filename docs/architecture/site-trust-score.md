# Site Trust Score — Diseño (actualizado octubre 2026)

> **Actualizacion (octubre 2026):** se corrigieron datos desactualizados de la version v0.0.9.24 de este documento. Las 4 fuentes tienen tipos, persistencia real (D1/SQLite), endpoint HTTP y UI de administracion; `apw-resolver` esta implementado; `schema.sql` ya tiene `key_algorithm`. La evolucion del modelo (atestaciones firmadas, historial encadenado, puntuacion por dimensiones y gobernanza de lectura) esta definida en [`docs/protocol-apw/APW-SPEC-v1.2.md`](../protocol-apw/APW-SPEC-v1.2.md).

**Estado real de implementación: las 4 fuentes tienen tipos, persistencia
real (D1/SQLite), endpoint HTTP conectado y forma de administrarse.**
`self` y `community` tienen UI pública y admin. `agent` y `escrow_report`
tienen UI de alta y revocación de quien puede reportar
(`/admin/authorized-agents` y `/admin/authorized-escrow-providers`); sus
reportes los generan agentes y proveedores programáticos, no humanos con
navegador. Las allowlists (`authorized_agents`, `authorized_escrow_providers`)
están vacías por defecto: no hay datos de producción hasta que el admin
autorice al menos un agente o proveedor real.

## Qué es y qué NO es

Site Trust Score califica **sitios completos**, no plugins. Es un dominio
deliberadamente separado de `packages/plugin-sandbox/src/registry/
plugin-registry.ts`.

## Por qué 4 fuentes, no una sola

Un solo número promediado pierde exactamente la información que hace útil
a un Trust Score. Las 4 fuentes tienen estatus epistémico distinto:

| Fuente | Estatus | Quién genera el dato | ¿Ausencia = señal? |
|---|---|---|---|
| `self` | Afirmación | El propio admin del sitio, declarando | No — neutral |
| `agent` | Verificación | Agentes de IA identificados vía Web Bot Auth | **Sí** — `verified: false` es señal negativa real |
| `community` | Atestación | Visitantes humanos, opinando | No — neutral |
| `escrow_report` | Ground truth | Terceros de escrow, reportando transacciones reales | No — neutral |

APW v1.2 agrupa estas fuentes en **dimensiones puntuadas de 1.0 a 7.0,
ponderadas por la reputación de quien evalúa** (Anexo A de la
especificación). Las 4 fuentes no desaparecen: son la procedencia de cada
atestación.

## Categorías por fuente

**`self`** (6): `gdpr_compliance`, `privacy_policy`, `terms_of_service`,
`payment_security`, `data_practices`, `contact_transparency`.

**`agent`** (5): `https_and_headers`, `structured_data_quality`,
`machine_readable_policies`, `content_freshness`, `bot_traffic_anomalies`.

**`community`** (4): `perceived_trustworthiness`, `content_accuracy`,
`spam_or_deceptive`, `responsiveness`.

**`escrow_report`** (1 campo, 3 valores): `transaction_outcome` ∈
`completed_as_promised` | `refunded_no_delivery` | `disputed`.

## Persistencia real: D1 y SQLite

`createSiteTrustScoreStore(env)` resuelve D1 → SQLite → memoria, mismo
patrón que `createPermissionStore()`.

## Los endpoints y sus modelos de auth

Ninguna de las 4 fuentes comparte el mismo mecanismo de auth — cada una
usa el que corresponde a quién genera ese dato de verdad:

| Endpoint | Método | Auth | Quién lo usa |
|---|---|---|---|
| `/trust/:siteId` | GET | Ninguna (público) | Cualquiera — lectura del snapshot completo |
| `/trust/:siteId/vote` | POST | Ninguna, rate-limited por IP | Visitantes humanos → `community` |
| `/admin/site-trust/:siteId/self` | PUT | Sesión + rol `admin` | El propio admin del sitio → `self` |
| `/trust/:siteId/agent-verification` | POST | Firma Web Bot Auth + allowlist `authorized_agents` | Agentes autorizados → `agent` |
| `/trust/:siteId/escrow-report` | POST | API key (Bearer) + allowlist `authorized_escrow_providers` | Proveedores de escrow autorizados → `escrow_report` |

### `agent`: identidad y autorización son 2 capas separadas

Web Bot Auth (RFC 9421 + draft-03, `packages/trust-layer/src/site-trust/
web-bot-auth.ts`, usando el paquete oficial `web-bot-auth`, con las mismas
reglas de headers que el middleware) responde "¿quién eres?" — cualquiera
puede generar un par Ed25519 y publicar un JWKS, así que identidad
verificada no implica autorización. `authorized_agents` resuelve "¿tienes
permiso?" por separado. El endpoint devuelve `401` si la identidad falla,
`403` si la identidad es válida pero el agente no está en la allowlist.

Limitación conocida: la firma Web Bot Auth cubre `@authority` y
`signature-agent`, no el cuerpo del request, así que el `verified` que
reporta el agente no está autenticado criptográficamente. APW v1.2
(sección 5.3) lo resuelve con atestaciones firmadas por el agente.

### `escrow_report`: sin mecanismo de autoservicio, a propósito

No existe un estándar público equivalente a Web Bot Auth para
proveedores de escrow. `authorized_escrow_providers` usa una API key por
proveedor (hasheada con SHA-256 antes de persistir, nunca la clave
cruda). La key se genera desde `/admin/authorized-escrow-providers` (se
muestra una sola vez) o con `scripts/onboard-escrow-provider.mjs`, y se
entrega al proveedor fuera de banda. Es deliberadamente la barrera de
entrada más alta de las 4 fuentes: `escrow_report` es la señal más
objetiva del diseño (ground truth, no predicción).

## Crypto-agilidad: por qué `authorized_agents` guarda el algoritmo

Web Bot Auth verifica firmas Ed25519, criptografía de curva elíptica
clásica, vulnerable al algoritmo de Shor en una computadora cuántica
suficientemente potente. NIST ya finalizó el reemplazo estandarizado:
FIPS 204 (ML-DSA), publicado el 13 de agosto de 2024.

`authorized_agents` tiene la columna `key_algorithm` (default
`"ed25519"`) en el `schema.sql` maestro, así que D1 y SQLite usan el
mismo esquema. Desde el PR #54, `site-trust/web-bot-auth.ts` verifica
también firmas ML-DSA-44/65/87 (experimental, con
`@noble/post-quantum`). El verificador del middleware
(`webbotauth/verify.ts`) sigue siendo solo Ed25519.

## Onboarding de `agent` y `escrow_report`

Dos caminos equivalentes:

- **UI**: `/admin/authorized-agents` y `/admin/authorized-escrow-providers`
  (listar, dar de alta, revocar con soft-delete).
- **CLI self-hosted**: `scripts/onboard-agent.mjs` y
  `scripts/onboard-escrow-provider.mjs`, idempotentes. Solo SQLite.

Un humano decide a quién autorizar: no hay flujo de autoservicio.

## UI conectada y navegación

`src/pages/trust/[siteId].astro` (pública) y `src/pages/admin/
site-trust/[siteId]/self.astro` (sesión + rol admin) cubren `self` y
`community`. Las páginas de allowlists cubren quién puede reportar
`agent` y `escrow_report`. Todas se enlazan desde `src/pages/admin/index.astro`.

## Rate-limiting del voto community

`site_trust_community_votes` tiene `ip_hash` e índice dedicado.
`isRateLimited()` consulta esa misma tabla. Límite: 1 voto por IP por
sitio+categoría cada 24h.

La IP del votante se obtiene con `getClientIp()`
(`packages/trust-layer/src/net/client-ip.ts`): en Cloudflare, el header
`CF-Connecting-IP`; en el runtime Node, el header interno
`x-portaless-client-ip`, que calcula el propio runtime (X-Forwarded-For
solo si la conexión viene de un proxy listado en
`PORTALESS_TRUSTED_PROXIES`, si no la IP del socket) después de descartar
cualquier header de IP enviado por el cliente. Antes, en self-host, el voto
respondía siempre `400 missing_client_ip`.

## Cómo se conecta con Protocol APW

`packages/apw-resolver/` resuelve la identidad del sitio (`did:apw`, TXT
`_apw.<dominio>` por DNS-over-HTTPS) y el manifiesto apunta a
`/trust/:siteId`. APW v1.2 define cómo este score se vuelve portable y
verificable por terceros: atestaciones firmadas por cada emisor,
historial encadenado con su cabeza publicada en el TXT, puntuación por
dimensiones y gobernanza de lectura (Loyola Trust Protocol).

## Arquitectura de "confianza irrelevante" — el rol real de este score

1. **Pre-filtro** (este score): descarta sitios obviamente malos.
2. **Autorización** (fuera de este repo): mandato criptográfico de gasto.
3. **Ejecución con escrow real** (fuera de este repo, tercero): custodia
   con condiciones de release.
4. **Cierre** (`escrow_report`, este dominio): el resultado real
   alimenta de vuelta el score.

Los pasos 2 y 3 no se construyen dentro de Portaless — requieren
licencias financieras de una entidad regulada.

## Limitaciones vigentes

- Las allowlists de `agent` y `escrow_report` están vacías por defecto:
  no hay datos de producción hasta que el admin autorice a alguien.
- No hay flujo de alta automática para proveedores de escrow; es
  intencional.
- Los datos son filas en la base del propio sitio: no son verificables
  por terceros ni portables. APW v1.2 (secciones 5.3 a 5.5) lo resuelve.
- El rate-limit del voto community es deliberadamente simple.
- `IP_HASH_SALT` cae a un salt fijo de desarrollo si no está configurado.
- No se calcula ningún resumen sobre `agent`/`escrow_report`; el Anexo A
  de APW v1.2 define cómo hacerlo por dimensiones.
- `/admin/index.astro` no lista sitios existentes.
- Los scripts de onboarding solo soportan SQLite (self-hosted).
