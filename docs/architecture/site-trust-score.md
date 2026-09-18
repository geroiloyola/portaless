# Site Trust Score — Diseño (v0.0.9.21)

**Estado real de implementación: tipos + persistencia real (D1/SQLite) +
3 endpoints HTTP + UI pública y admin, con navegación y rate-limiting +
módulo de verificación de identidad de agentes (sin endpoint conectado
todavía).** `packages/trust-layer/src/site-trust/site-trust-score.ts`
define los tipos y `InMemorySiteTrustScoreStore`. `store-factory.ts`
conecta `D1SiteTrustScoreStore` o `SqliteSiteTrustScoreStore` según el
entorno. `functions/trust/[siteId].js`, `functions/trust/[siteId]/vote.js`
y `functions/admin/site-trust/[siteId]/self.js` exponen 2 de las 4
fuentes. `src/pages/trust/[siteId].astro`, `src/pages/admin/site-trust/
[siteId]/self.astro` y `src/pages/admin/index.astro` completan la UI y
navegación. El voto de `community` tiene rate-limiting server-side por
IP. Desde v0.0.9.21, existe el módulo `web-bot-auth.ts` + la allowlist
`authorized_agents` — el primer paso hacia desbloquear la fuente `agent`
— pero **todavía no hay ningún endpoint que los use**; eso es el
siguiente commit del plan. `escrow_report` sigue completamente sin
tocar.

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

`agent` y `escrow_report` todavía no tienen endpoint conectado — ver la
siguiente sección para el progreso en `agent`.

## Verificación de identidad de agentes (v0.0.9.21)

`packages/trust-layer/src/site-trust/web-bot-auth.ts` implementa **solo
verificación** de identidad vía Web Bot Auth (RFC 9421 HTTP Message
Signatures, draft-meunier-web-bot-auth-architecture). Portaless nunca
firma nada — únicamente valida firmas de agentes externos.

**Usa el paquete oficial `web-bot-auth` de Cloudflare** (`verify()` +
`verifierFromJWK()` de `web-bot-auth/crypto`) en vez de reimplementar la
reconstrucción del signature base string — ese formato específico ya está
manejado correctamente por la librería oficial.

### Identidad ≠ autorización — por qué existe `authorized_agents`

Web Bot Auth responde **"¿quién eres?"**, nunca **"¿tienes permiso?"**.
Cualquiera puede generar un par de claves Ed25519, publicar un JWKS en su
propio dominio, y `verifyWebBotAuthRequest()` lo validaría como una firma
genuina — porque lo es. Eso no significa que ese agente deba poder
reportar `verified: true` sobre cualquier sitio.

`authorized_agents` (tabla nueva en `schema.sql`) es la allowlist que
resuelve esa segunda pregunta: solo agentes cuyo `agent_key_id` esté en
esta tabla, con `active = 1`, pueden reportar. Fase 1 (esta versión) es
deliberadamente estricta y manual — Portaless agrega agentes conocidos a
mano. Una fase 2 futura (no implementada) podría abrir a cualquier agente
verificado con un peso reducido en el score, en vez de bloquear por
completo a los no listados.

### Cache del JWKS

Cada invocación de una Cloudflare Pages Function es stateless — sin
cache, cada verificación haría un fetch HTTP al dominio del agente.
`fetchJwksWithCache()` usa un KV namespace (`env.JWKS_CACHE`) con TTL de
6h. Sin KV configurado, cae a fetch directo con warning explícito.

### Limitaciones de este commit puntual

- **No hay endpoint todavía** que use `web-bot-auth.ts` +
  `authorized_agents` — este commit es solo el módulo de verificación,
  el endpoint `POST /trust/:siteId/agent-verification` es el siguiente
  paso del plan.
- **Tests con test runner no confirmado**: `web-bot-auth.test.ts` usa la
  clave de test pública de RFC 9421 Appendix B.1.4, pero no se pudo
  confirmar si el repo tiene `vitest` (u otro runner) instalado — la
  ejecución de estos tests depende de eso.
- **`package.json` no se modificó**: falta agregar la dependencia
  `web-bot-auth` como paso manual — no se editó a ciegas sin poder leer
  el contenido real del archivo.

## UI conectada y navegación

`src/pages/trust/[siteId].astro` (pública), `src/pages/admin/site-trust/
[siteId]/self.astro` (sesión + rol admin, con breadcrumb) y
`src/pages/admin/index.astro` (índice del dashboard) completan el ciclo
tipos → persistencia → endpoint → UI para `self` y `community`.

## Rate-limiting del voto community

`site_trust_community_votes` tiene una columna `ip_hash`
(`SHA-256(ip + salt)`) y un índice dedicado
`idx_site_trust_community_rate_limit`. `isRateLimited()` en
`SiteTrustScoreStore` consulta esa misma tabla — no es un store ni una
tabla separada. `functions/trust/[siteId]/vote.js` la llama antes de
`recordCommunityVote()` y devuelve `429` si corresponde. La IP llega vía
`CF-Connecting-IP`. El límite es 1 voto por IP por sitio+categoría cada
24h — suficiente para que el ataque sea "más molesto que útil", ya que
`community` es la señal más débil de las 4 por diseño.

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

- **`agent`**: el módulo de verificación de identidad y la allowlist de
  autorización existen, pero no hay ningún endpoint HTTP que los
  conecte todavía. Próximo commit del plan.
- **`escrow_report`**: completamente sin tocar — necesita su propia
  allowlist de proveedores autorizados (`authorized_escrow_providers`,
  no implementada), análoga a `authorized_agents` pero con credenciales
  tipo API key en vez de Web Bot Auth.
- El rate-limit del voto community es deliberadamente simple (1 voto por
  IP por sitio+categoría cada 24h) — no usa CAPTCHA/Turnstile.
- `IP_HASH_SALT` cae a un salt fijo de desarrollo si no está configurado.
- `packages/apw-resolver/` sigue siendo un stub.
- No se calcula ningún promedio o resumen sobre `agent`/`escrow_report`.
- `/admin/index.astro` no lista sitios existentes — pide el `siteId`
  manualmente.
- No se confirmó si el repo tiene un test runner (`vitest` u otro)
  instalado — los tests nuevos de `web-bot-auth.ts` dependen de eso.
- `package.json` no incluye todavía la dependencia `web-bot-auth` —
  paso manual pendiente.
