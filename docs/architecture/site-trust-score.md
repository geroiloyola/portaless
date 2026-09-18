# Site Trust Score — Diseño (v0.0.9.19)

**Estado real de implementación: tipos + persistencia real (D1/SQLite) +
3 endpoints HTTP + UI pública y admin, con navegación y rate-limiting.**
`packages/trust-layer/src/site-trust/site-trust-score.ts` define los
tipos y `InMemorySiteTrustScoreStore`. `store-factory.ts` conecta
`D1SiteTrustScoreStore` o `SqliteSiteTrustScoreStore` según el entorno.
`functions/trust/[siteId].js`, `functions/trust/[siteId]/vote.js` y
`functions/admin/site-trust/[siteId]/self.js` exponen 2 de las 4 fuentes.
`src/pages/trust/[siteId].astro`, `src/pages/admin/site-trust/[siteId]/
self.astro` y `src/pages/admin/index.astro` completan la UI y navegación.
Desde v0.0.9.19, el voto de `community` tiene rate-limiting server-side
por IP — ver "Rate-limiting". Sigue pendiente: `agent` y `escrow_report`
sin endpoint ni UI, por falta de un mecanismo de autenticación real.

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

`agent` y `escrow_report` no tienen endpoint todavía: ambos requieren un
mecanismo de autenticación que no existe en el repo.

## UI conectada y navegación

`src/pages/trust/[siteId].astro` (pública), `src/pages/admin/site-trust/
[siteId]/self.astro` (sesión + rol admin, con breadcrumb) y
`src/pages/admin/index.astro` (índice del dashboard) completan el ciclo
tipos → persistencia → endpoint → UI para `self` y `community`.

## Rate-limiting del voto community (v0.0.9.19)

El voto de `community` es público y sin sesión por diseño (es atestación
de visitante, no requiere cuenta Portaless). Hasta v0.0.9.18, la única
defensa era `voterId` en `localStorage` — trivial de eludir borrando el
storage del navegador. Esta versión agrega una defensa real, del lado del
servidor:

**No es una tabla ni un store separado.** `site_trust_community_votes`
agrega una columna `ip_hash` (`SHA-256(ip + salt)`, la IP cruda nunca se
persiste). El chequeo de rate-limit es un `SELECT 1` sobre la misma tabla
de votos: "¿existe una fila con este `site_id`+`category`+`ip_hash`
dentro de la ventana de 24h?". `isRateLimited()` (nuevo método en
`SiteTrustScoreStore`, implementado en ambos backends) encapsula esa
consulta, respaldada por el índice dedicado
`idx_site_trust_community_rate_limit (site_id, category, ip_hash,
voted_at)` — sin él, el `SELECT` degrada a table scan a medida que la
tabla crece.

`functions/trust/[siteId]/vote.js` llama a `isRateLimited()` **antes**
de `recordCommunityVote()`, y devuelve `429` si ya existe un voto de esa
IP para ese sitio+categoría en la ventana. Esto es exactamente lo que
evita que borrar `localStorage` sirva para eludir el límite: el chequeo
es por IP, no por `voterId`.

La IP llega vía el header `CF-Connecting-IP` — el header canónico en
Cloudflare Pages/Workers, siempre presente, a diferencia de
`x-forwarded-for` que Cloudflare no garantiza en el mismo formato. El
salt para el hash viene de `env.IP_HASH_SALT`; si no está configurado, se
usa un salt fijo de desarrollo con warning explícito en consola (nunca
bloquea el voto por falta de configuración, pero avisa).

**Por qué esta ventana y este límite son suficientes**: `community` es la
señal más débil de las 4 por diseño — es atestación, no verificación
técnica ni ground truth. El objetivo del rate-limit no es hacer el ataque
imposible, sino hacerlo "más molesto que útil": pasar de "gratis" (borrar
localStorage) a "necesito N IPs distintas para mover el promedio un
puñado de puntos porcentuales". No pretende ser criptográficamente
robusto ni sustituye algo como Cloudflare Turnstile (evaluado, descartado
para esta iteración por friccionar a usuarios reales sin necesidad —
queda como opción de fase 2 si el abuso real lo justifica).

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

- No existe ningún endpoint HTTP ni UI para `agent` ni `escrow_report`
  todavía — falta un mecanismo de autenticación real para ambos.
- El rate-limit del voto community es deliberadamente simple (1 voto por
  IP por sitio+categoría cada 24h) — no usa CAPTCHA/Turnstile ni ningún
  mecanismo anti-bot más sofisticado. Un atacante con múltiples IPs
  reales sigue pudiendo votar múltiples veces; solo se elevó el costo del
  ataque, no se eliminó.
- `IP_HASH_SALT` cae a un salt fijo de desarrollo si no está configurado
  en el entorno — funcional pero no ideal para producción (todos los
  despliegues sin configurar ese secret comparten el mismo salt).
- `packages/apw-resolver/` sigue siendo un stub.
- No se calcula todavía ningún promedio o resumen sobre `agent`/
  `escrow_report` — la UI muestra la verificación más reciente y el
  historial completo de escrow, pero no un "% de verificaciones
  exitosas" calculado.
- `/admin/index.astro` no lista sitios existentes — pide el `siteId`
  manualmente en vez de ofrecer un selector.
