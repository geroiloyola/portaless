# Site Trust Score — Diseño (v0.0.9.18)

**Estado real de implementación: tipos + persistencia real (D1/SQLite) +
3 endpoints HTTP + UI pública y admin, con navegación.**
`packages/trust-layer/src/site-trust/site-trust-score.ts` define los
tipos y `InMemorySiteTrustScoreStore`. `store-factory.ts` conecta
`D1SiteTrustScoreStore` o `SqliteSiteTrustScoreStore` según el entorno.
`functions/trust/[siteId].js` (lectura pública), `functions/trust/
[siteId]/vote.js` (voto community) y `functions/admin/site-trust/
[siteId]/self.js` (declaración self) exponen 2 de las 4 fuentes.
`src/pages/trust/[siteId].astro` y `src/pages/admin/site-trust/[siteId]/
self.astro` son las 2 páginas que los consumen — y `src/pages/admin/
index.astro` (nuevo) es el primer punto de entrada real del dashboard
admin, con breadcrumbs de ida y vuelta entre ambas páginas. Sigue
pendiente: `agent` y `escrow_report` sin endpoint ni UI, y rate-limiting
en el voto — ver "Limitaciones honestas".

## Qué es y qué NO es

Site Trust Score califica **sitios completos**, no plugins. Es un dominio
deliberadamente separado de `packages/plugin-sandbox/src/registry/
plugin-registry.ts` (que califica plugins instalados en un sitio) — mezclar
ambos en la misma tabla o el mismo tipo habría sido un error de modelado:
"¿confío en este plugin que un sitio instaló?" y "¿confío en este sitio?"
son preguntas de dominios distintos, aunque compartan el mismo mecanismo
de votación 1-5 con comentario.

## Por qué 4 fuentes, no una sola

Un solo número promediado pierde exactamente la información que hace útil
a un Trust Score. Las 4 fuentes tienen estatus epistémico distinto:

| Fuente | Estatus | Quién genera el dato | ¿Ausencia = señal? |
|---|---|---|---|
| `self` | Afirmación | El propio admin del sitio, declarando | No — neutral |
| `agent` | Verificación | Agentes de IA identificados vía Web Bot Auth, comprobando técnicamente | **Sí** — `verified: false` es señal negativa real |
| `community` | Atestación | Visitantes humanos, opinando sobre su experiencia | No — neutral |
| `escrow_report` | Ground truth | Terceros de escrow, reportando el resultado real de una transacción | No — neutral (sin transacciones aún) |

**El caso especial de `agent`**: a diferencia de las otras 3 fuentes, la
ausencia de una fila en `site_trust_agent_verifications` no es lo mismo
que `verified: false`. Ausencia significa "ningún agente corrió esa
verificación todavía" (neutral). `verified: false` significa "un agente
lo intentó y falló" (ej. sin TLS válido) — una señal negativa real que
debe pesar distinto.

**Por qué `escrow_report` es la señal más fuerte**: las otras 3 fuentes
son predictoras — intentan anticipar si un sitio es confiable. El reporte
de escrow es lo que **de verdad ocurrió** con una transacción real. Un
agente que consulta esta fuente tiene la respuesta directa a la pregunta
que más importa en comercio: "¿este sitio entrega lo que promete?".

## Categorías por fuente

**`self`** (6): `gdpr_compliance`, `privacy_policy`, `terms_of_service`,
`payment_security`, `data_practices`, `contact_transparency`.

**`agent`** (5): `https_and_headers`, `structured_data_quality`,
`machine_readable_policies`, `content_freshness`, `bot_traffic_anomalies`.

**`community`** (4): `perceived_trustworthiness`, `content_accuracy`,
`spam_or_deceptive`, `responsiveness`.

**`escrow_report`** (1 campo, 3 valores posibles): `transaction_outcome`
∈ `completed_as_promised` | `refunded_no_delivery` | `disputed`.

## Persistencia real: D1 y SQLite

`createSiteTrustScoreStore(env)` resuelve el backend igual que
`createPermissionStore()`: `env.DB` → `D1SiteTrustScoreStore`;
`env.PORTALESS_SQLITE_PATH` → `SqliteSiteTrustScoreStore`; si ninguno
está disponible, cae a `InMemorySiteTrustScoreStore` con advertencia
explícita en consola. `self` y `community` sobrescriben el valor más
reciente por categoría (u por categoría+votante); `agent` y
`escrow_report` insertan un registro histórico nuevo en cada llamada.

## Endpoints HTTP conectados

| Endpoint | Método | Auth | Quién lo usa |
|---|---|---|---|
| `/trust/:siteId` | GET | Ninguna (público) | Protocol APW, agentes externos, dashboard |
| `/trust/:siteId/vote` | POST | Ninguna (público, `voterId` anónimo) | Visitantes humanos votando `community` |
| `/admin/site-trust/:siteId/self` | PUT | Sesión + rol `admin` | El propio admin del sitio, declarando `self` |

`agent` y `escrow_report` no tienen endpoint todavía: ambos requieren un
mecanismo de autenticación que no existe en el repo (Web Bot Auth para
agentes verificadores, API key/firma por proveedor de escrow).

## UI conectada y navegación (v0.0.9.18)

**`src/pages/trust/[siteId].astro`** — pública, sin auth. Muestra las 4
fuentes con la semántica visual correcta: `self` neutral vs. declarado;
`agent` distingue "Sin verificar" (neutral) de "Verificación fallida"
(rojo); `community` con formulario de voto (`voterId` anónimo en
`localStorage`); `escrow_report` con historial completo, color por
resultado.

**`src/pages/admin/site-trust/[siteId]/self.astro`** — sesión + rol
admin. Formulario por categoría con checkbox + URL de evidencia. Desde
v0.0.9.18 incluye un breadcrumb de ida y vuelta: link a `/admin` y link a
la vista pública `/trust/:siteId` del mismo sitio.

**`src/pages/admin/index.astro`** (nuevo) — primer punto de entrada real
del dashboard admin. Hasta esta versión no existía ningún `/admin/index.astro`;
cada página admin (`permissions.astro`, y luego `site-trust/[siteId]/
self.astro`) solo era alcanzable escribiendo la URL a mano. Este índice
linkea directo a `/admin/permissions`, y expone un pequeño formulario que
pide un `siteId` antes de navegar a su autoevaluación — no asume ningún
sitio por defecto, porque el repo todavía no tiene un registro de "sitios
conocidos" (equivalente al `KNOWN_SUBJECTS` que sí existe para plugins en
`functions/admin/permissions/index.js`).

## Cómo se conecta con Protocol APW

`packages/apw-resolver/` (hoy stub) resuelve identidad de un sitio vía
`did:web`/DNS. Site Trust Score es el dato de **confianza** que ese
resolver expondría junto a la identidad.

## Arquitectura de "confianza irrelevante" — el rol real de este score

Site Trust Score **no es** el mecanismo que hace que una transacción sea
segura. Es el **pre-filtro de eficiencia** que reduce cuánto necesitas
confiar antes de comprometerte a algo más costoso:

1. **Pre-filtro (este score)**: descarta sitios obviamente malos.
2. **Autorización** (fuera de este repo): mandato criptográfico de gasto.
3. **Ejecución con escrow real** (fuera de este repo, tercero): custodia
   con condiciones de release.
4. **Cierre** (`escrow_report`, este dominio): el resultado real
   alimenta de vuelta el score.

Los pasos 2 y 3 no se construyen dentro de Portaless, misma razón que
`ROADMAP.md` documenta para Pay per Crawl: requiere licencias financieras
de una entidad regulada.

## Limitaciones honestas

- No existe ningún endpoint HTTP ni UI para `agent` ni `escrow_report`
  todavía — falta un mecanismo de autenticación real para ambos.
- El endpoint `/trust/:siteId/vote` no implementa rate-limiting ni
  prevención de abuso todavía — `voterId` es una huella anónima de
  `localStorage`, y nada impide borrarla y votar de nuevo. Próximo paso
  planeado: rate-limit por IP hasheada (`SHA-256(ip + salt)`, nunca la IP
  cruda) con ventana de 24h — suficiente para que el ataque sea "más
  molesto que útil", ya que `community` es la señal más débil de las 4
  por diseño (es atestación, no verificación ni ground truth).
- `packages/apw-resolver/` sigue siendo un stub — este score no está
  conectado a ninguna resolución real de `did:web` todavía.
- No se calcula todavía ningún promedio o resumen sobre `agent`/`escrow_report`
  (que acumulan historial) — la UI muestra la verificación más reciente y
  el historial completo de escrow, pero no un "% de verificaciones
  exitosas" calculado.
- `/admin/index.astro` no lista sitios existentes (no hay registro de
  "sitios conocidos" en el repo) — el formulario de acceso a la
  autoevaluación pide el `siteId` manualmente en vez de ofrecer un
  selector.
