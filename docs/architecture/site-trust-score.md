# Site Trust Score — Diseño (v0.0.9.22)

**Estado real de implementación: tipos + persistencia real (D1/SQLite) +
4 endpoints HTTP + UI pública y admin, con navegación y rate-limiting +
verificación de identidad y autorización de agentes.**
`packages/trust-layer/src/site-trust/site-trust-score.ts` define los
tipos y `InMemorySiteTrustScoreStore`. `store-factory.ts` conecta
`D1SiteTrustScoreStore` o `SqliteSiteTrustScoreStore` según el entorno.
`functions/trust/[siteId].js`, `functions/trust/[siteId]/vote.js`,
`functions/admin/site-trust/[siteId]/self.js` y **`functions/trust/
[siteId]/agent-verification.js`** (nuevo) exponen 3 de las 4 fuentes.
`src/pages/trust/[siteId].astro`, `src/pages/admin/site-trust/[siteId]/
self.astro` y `src/pages/admin/index.astro` completan la UI y navegación
— la sección `agent` de la página pública ya sabía renderizar
`verified: true/false` desde el commit de UI original; ahora, por
primera vez, puede recibir datos reales. `escrow_report` sigue
completamente sin tocar — es la única fuente que falta.

## Qué es y qué NO es

Site Trust Score califica **sitios completos**, no plugins. Es un dominio
deliberadamente separado de `packages/plugin-sandbox/src/registry/
plugin-registry.ts` — mezclar ambos en la misma tabla o el mismo tipo
habría sido un error de modelado.

## Por qué 4 fuentes, no una sola

Un solo número promediado pierde exactamente la información que hace útil
a un Trust Score. Las 4 fuentes tienen estatus epistémico distinto:

| Fuente | Estatus | Quién genera el dato | ¿Ausencia = señal? |
|---|---|---|---|
| `self` | Afirmación | El propio admin del sitio, declarando | No — neutral |
| `agent` | Verificación | Agentes de IA identificados vía Web Bot Auth, comprobando técnicamente | **Sí** — `verified: false` es señal negativa real |
| `community` | Atestación | Visitantes humanos, opinando sobre su experiencia | No — neutral |
| `escrow_report` | Ground truth | Terceros de escrow, reportando el resultado real de una transacción | No — neutral (sin transacciones aún) |

**El caso especial de `agent`**: ausencia de fila significa "nadie
verificó todavía" (neutral); `verified: false` significa "un agente
verificó y falló" — señal negativa real.

**Por qué `escrow_report` es la señal más fuerte**: es lo que de verdad
ocurrió con una transacción real, no una predicción.

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

`createSiteTrustScoreStore(env)` resuelve el backend igual que
`createPermissionStore()`: `env.DB` → `D1SiteTrustScoreStore`;
`env.PORTALESS_SQLITE_PATH` → `SqliteSiteTrustScoreStore`; si ninguno
está disponible, cae a `InMemorySiteTrustScoreStore`.

## Endpoints HTTP conectados

| Endpoint | Método | Auth | Quién lo usa |
|---|---|---|---|
| `/trust/:siteId` | GET | Ninguna (público) | Protocol APW, agentes externos, dashboard |
| `/trust/:siteId/vote` | POST | Ninguna (público, rate-limited por IP) | Visitantes humanos votando `community` |
| `/admin/site-trust/:siteId/self` | PUT | Sesión + rol `admin` | El propio admin del sitio, declarando `self` |
| `/trust/:siteId/agent-verification` | POST | Firma Web Bot Auth + allowlist `authorized_agents` | Agentes autorizados reportando `agent` |

`escrow_report` es la única fuente que todavía no tiene endpoint.

## Verificación de identidad y autorización de agentes (v0.0.9.21–22)

`packages/trust-layer/src/site-trust/web-bot-auth.ts` implementa **solo
verificación** de identidad vía Web Bot Auth (RFC 9421 HTTP Message
Signatures). Usa el paquete oficial `web-bot-auth` de Cloudflare
(`verify()` + `verifierFromJWK()`) en vez de reimplementar la
reconstrucción del signature base string.

**Identidad ≠ autorización**: Web Bot Auth responde "¿quién eres?",
nunca "¿tienes permiso?". `authorized_agents` (tabla en `schema.sql` +
módulo `authorized-agents.ts`) resuelve la segunda pregunta — solo
agentes con `agent_key_id` en esa tabla, `active = 1`, pueden reportar.
Fase 1 (actual): allowlist estricta y manual.

### El endpoint: dos capas de seguridad en orden

`POST /trust/:siteId/agent-verification` (`functions/trust/[siteId]/
agent-verification.js`) aplica ambas capas en secuencia:

1. **Identidad** (`verifyWebBotAuthRequest`): sin firma válida → `401`.
   A diferencia de `/trust/:siteId/vote`, este endpoint no acepta
   tráfico anónimo — la fuente `agent` es verificación técnica, no
   atestación de visitante.
2. **Autorización** (`authorized_agents.isAuthorized`): identidad válida
   pero agente no autorizado → `403`. Esta distinción de status code es
   intencional: `401` significa "no sabemos quién eres", `403` significa
   "sabemos quién eres, pero no tenés permiso" — información útil para
   quien integra un agente nuevo y necesita entender por qué falla.

Solo tras pasar ambas capas se persiste `recordAgentVerification()` con
el `verified` que el agente reporta sobre la categoría — ese valor
(`true` o `false`) es información válida sobre el *sitio* en ambos casos;
lo que se bloquea en las capas 1 y 2 es la identidad/autorización del
*reportante*, no el contenido de su reporte.

### Cache del JWKS

Cada invocación de una Cloudflare Pages Function es stateless.
`fetchJwksWithCache()` usa un KV namespace (`env.JWKS_CACHE`) con TTL de
6h. Sin KV configurado, cae a fetch directo con warning explícito.

## UI conectada y navegación

`src/pages/trust/[siteId].astro` (pública), `src/pages/admin/site-trust/
[siteId]/self.astro` (sesión + rol admin, con breadcrumb) y
`src/pages/admin/index.astro` (índice del dashboard). La sección `agent`
de la página pública ya distinguía visualmente "Sin verificar" (neutral)
de "Verificación fallida" (rojo) desde su commit original — ahora recibe
datos reales por primera vez, sin necesitar ningún cambio de código.

## Rate-limiting del voto community

`site_trust_community_votes` tiene `ip_hash` (`SHA-256(ip + salt)`) e
índice dedicado. `isRateLimited()` consulta esa misma tabla — no es un
store separado. Límite: 1 voto por IP por sitio+categoría cada 24h.

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

- **`escrow_report`**: la única fuente sin endpoint todavía. Necesita su
  propia allowlist de proveedores autorizados
  (`authorized_escrow_providers`, no implementada), análoga a
  `authorized_agents` pero con credenciales tipo API key en vez de Web
  Bot Auth — próximo commit del plan.
- `authorized_agents` está vacía por defecto — hasta que alguien inserte
  manualmente un `agent_key_id` real, ningún reporte de `agent` puede
  pasar la capa de autorización. No hay UI ni endpoint para agregar
  agentes a la allowlist todavía; es una operación manual sobre la base
  de datos.
- No se confirmó si `.github/workflows/ci.yml` ejecuta `npm test` — el
  script existe (`vitest run`), pero puede no estar conectado al
  pipeline todavía. No bloqueante para el funcionamiento real del
  endpoint, solo afecta la cobertura de tests automatizados en CI.
- El rate-limit del voto community es deliberadamente simple.
- `IP_HASH_SALT` cae a un salt fijo de desarrollo si no está configurado.
- `packages/apw-resolver/` sigue siendo un stub.
- No se calcula ningún promedio o resumen sobre `agent`/`escrow_report`.
- `/admin/index.astro` no lista sitios existentes.
