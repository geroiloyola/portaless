# Site Trust Score — Diseño (v0.0.9.24)

**Estado real de implementación: las 4 fuentes tienen tipos, persistencia
real (D1/SQLite) y endpoint HTTP conectado.** `self` y `community` además
tienen UI (pública y admin) y navegación. `agent` y `escrow_report` tienen
endpoint funcional pero **sin UI de escritura ni datos reales todavía** —
sus allowlists (`authorized_agents`, `authorized_escrow_providers`) están
vacías por defecto. Ya existe tooling CLI self-hosted para poblarlas
(`scripts/onboard-agent.mjs`, `scripts/onboard-escrow-provider.mjs`), pero
sigue siendo un alta manual: un humano decide a quién autorizar y corre el
comando, no hay ningún flujo de autoservicio ni UI de administración. La
sección `agent` de la página pública (`/trust/:siteId`) ya sabía renderizar
estos datos desde su commit original — simplemente no tiene nada que
mostrar hasta que se autorice al menos un agente o proveedor real.

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

## Los 4 endpoints, y sus 4 modelos de auth distintos

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

Web Bot Auth (RFC 9421, `packages/trust-layer/src/site-trust/
web-bot-auth.ts`, usando el paquete oficial de Cloudflare) responde
"¿quién eres?" — cualquiera puede generar un par Ed25519 y publicar un
JWKS, así que identidad verificada no implica autorización.
`authorized_agents` resuelve "¿tienes permiso?" por separado. El endpoint
devuelve `401` si la identidad falla, `403` si la identidad es válida
pero el agente no está en la allowlist — la distinción de status code es
intencional y ayuda a diagnosticar integraciones nuevas.

### `escrow_report`: sin mecanismo de autoservicio, a propósito

No existe un estándar público equivalente a Web Bot Auth para
proveedores de escrow. `authorized_escrow_providers` usa una API key por
proveedor (hasheada con SHA-256 antes de persistir, nunca la clave
cruda), que Portaless entrega manualmente y fuera de banda la primera
vez que un proveedor real se integra — no hay ningún flujo de alta
automática. Es deliberadamente la barrera de entrada más alta de las 4
fuentes: `escrow_report` es la señal más objetiva del diseño (ground
truth, no predicción), y esa barrera protege que solo entren datos de
proveedores verificados manualmente por Portaless. `hashApiKey()`
reutiliza `crypto.subtle.digest("SHA-256", ...)`, la misma primitiva ya
usada para hashear IPs en el rate-limit del voto community.

## Crypto-agilidad: por que `authorized_agents` guarda el algoritmo

Web Bot Auth (usado hoy por la fuente `agent`) verifica firmas Ed25519 —
criptografia de curva eliptica clasica, vulnerable al algoritmo de Shor
en una computadora cuantica suficientemente potente. Esto no es
exclusivo de Portaless: toda la industria que adopto Web Bot Auth
(Cloudflare, OpenAI, Amazon) usa el mismo algoritmo hoy, priorizando
velocidad y simplicidad sobre resistencia cuantica, porque las
computadoras cuanticas capaces de romperlo todavia no existen.

NIST ya finalizo el reemplazo estandarizado: FIPS 204 (ML-DSA),
publicado el 13 de agosto de 2024, con el mismo estatus legal que
AES/SHA-2 — no es una apuesta a un algoritmo futuro sin definir, ya
tiene implementaciones de produccion.

v0.0.9.24 agrego la columna `key_algorithm` (default `"ed25519"`) a
`authorized_agents` — solo al backend SQLite por ahora, ver limitacion
abajo — y el flag `--key-algorithm` en `scripts/onboard-agent.mjs`. Esto
**no implementa verificacion ML-DSA**: `web-bot-auth.ts` sigue
verificando exclusivamente Ed25519. Lo unico que hace es dejar el
esquema listo para no requerir una migracion de datos con filas reales
ya en produccion en sitios de terceros el dia que se agregue un segundo
algoritmo — costo de agregar la columna ahora: trivial; costo de
agregarla despues, con agentes reales ya autorizados en instalaciones de
terceros: una migracion de datos con downtime o retrocompatibilidad
cuidadosa.

**Limitacion de esta migracion**: `schema.sql` (la fuente de verdad para
D1) no se actualizo — no se pudo verificar su contenido exacto con las
herramientas disponibles al momento de este cambio, y editarlo sin
verlo arriesgaba corromper el esquema real de produccion.
`D1AuthorizedAgentsStore` sigue funcionando (lee columnas por nombre),
pero las filas que D1 inserte no tendran `key_algorithm` hasta que
alguien con acceso directo al archivo agregue `key_algorithm TEXT NOT
NULL DEFAULT 'ed25519'` a la definicion de `authorized_agents` en
`schema.sql`. Ver ROADMAP.md, seccion "Funcionalidades Internas en
Desarrollo".

## Onboarding de `agent` y `escrow_report`: CLI self-hosted, Fase 1

`scripts/onboard-agent.mjs` y `scripts/onboard-escrow-provider.mjs`
reemplazan el SQL manual contra el archivo SQLite por un comando
reproducible e idempotente (`INSERT ... ON CONFLICT DO UPDATE`, mismo
patrón que `setGrant()` en `sqlite-permission-store.ts`). Self-hosted
only (`PORTALESS_SQLITE_PATH`) — no hay variante D1 todavía; si se
necesita para producción en Cloudflare, replicar el mismo patrón que
`D1AuthorizedAgentsStore`/`D1AuthorizedEscrowProvidersStore`.

`onboard-escrow-provider.mjs` genera la API key real con
`crypto.randomBytes(32)`, la imprime una sola vez en stdout para
entregarla fuera de banda al proveedor, y persiste solo su hash — nunca
la clave cruda. Re-correr el comando con el mismo `provider-id` rota la
key (útil si una key se compromete). `onboard-agent.mjs` no genera
ningún secreto — el agente ya posee su propio par Ed25519 vía Web Bot
Auth, así que autorizar solo requiere registrar su `agent-key-id`.

Esto sigue siendo Fase 1: un humano decide a quién autorizar y corre el
comando manualmente. No hay UI de administración ni flujo de
autoservicio — ver "Limitaciones honestas" abajo.

## UI conectada y navegación

`src/pages/trust/[siteId].astro` (pública) y `src/pages/admin/
site-trust/[siteId]/self.astro` (sesión + rol admin) cubren `self` y
`community` de punta a punta, con `src/pages/admin/index.astro` como
punto de entrada del dashboard. **`agent` y `escrow_report` no tienen
ninguna UI de escritura** — sus únicos clientes posibles son agentes de
IA y proveedores de escrow programáticos, no humanos con navegador. La
UI pública ya renderiza sus datos si existen (heredado del commit
original de UI), pero no hay forma humana de generarlos desde el
navegador (el CLI de onboarding corre por terminal, no por UI).

## Rate-limiting del voto community

`site_trust_community_votes` tiene `ip_hash` e índice dedicado.
`isRateLimited()` consulta esa misma tabla. Límite: 1 voto por IP por
sitio+categoría cada 24h.

## Cómo se conecta con Protocol APW

`packages/apw-resolver/` (hoy stub) resuelve identidad de un sitio vía
`did:web`/DNS. Site Trust Score es el dato de confianza que ese resolver
expondría junto a la identidad.

## Arquitectura de "confianza irrelevante" — el rol real de este score

1. **Pre-filtro** (este score): descarta sitios obviamente malos.
2. **Autorización** (fuera de este repo): mandato criptográfico de gasto.
3. **Ejecución con escrow real** (fuera de este repo, tercero): custodia
   con condiciones de release.
4. **Cierre** (`escrow_report`, este dominio): el resultado real
   alimenta de vuelta el score.

Los pasos 2 y 3 no se construyen dentro de Portaless — requieren
licencias financieras de una entidad regulada.

## Limitaciones honestas

- **Las 4 fuentes tienen endpoint, pero solo 2 (`self`, `community`)
  tienen UI y datos reales de ejemplo.** `agent` y `escrow_report`
  funcionan solo si alguien corre `scripts/onboard-agent.mjs` o
  `scripts/onboard-escrow-provider.mjs` para insertar una fila en
  `authorized_agents` o `authorized_escrow_providers` — ninguna de las
  dos tablas tiene datos por defecto, y no existe UI de administración
  para gestionarlas. Sigue siendo un alta manual, ahora con un comando
  reproducible en vez de SQL escrito a mano.
- No hay ningún flujo de alta automática para proveedores de escrow —
  es intencional (ver sección arriba), pero significa que integrar un
  proveedor real requiere coordinación humana fuera de este código
  (aunque ya con tooling CLI para la parte de persistencia).
- No se confirmó si `.github/workflows/ci.yml` ejecuta `npm test`.
- El rate-limit del voto community es deliberadamente simple.
- `IP_HASH_SALT` cae a un salt fijo de desarrollo si no está configurado.
- `packages/apw-resolver/` sigue siendo un stub.
- No se calcula ningún promedio o resumen sobre `agent`/`escrow_report`
  — ambos acumulan historial crudo, sin agregación.
- `/admin/index.astro` no lista sitios existentes.
- Los scripts de onboarding solo soportan SQLite (self-hosted); no hay
  variante D1 todavía.
- `schema.sql` (D1) no tiene la columna `key_algorithm` todavia -- solo
  el backend SQLite la tiene (ver "Crypto-agilidad" arriba). Pendiente
  que alguien con acceso directo al archivo la agregue a mano.
