# Site Trust Score — Diseño (v0.0.9.17)

**Estado real de implementación: tipos + persistencia real (D1/SQLite) +
3 endpoints HTTP + UI pública y admin.** `packages/trust-layer/src/
site-trust/site-trust-score.ts` define los tipos y `InMemorySiteTrustScoreStore`.
`store-factory.ts` conecta `D1SiteTrustScoreStore` o `SqliteSiteTrustScoreStore`
según el entorno. `functions/trust/[siteId].js` (lectura pública),
`functions/trust/[siteId]/vote.js` (voto community) y `functions/admin/
site-trust/[siteId]/self.js` (declaración self) exponen 2 de las 4
fuentes. `src/pages/trust/[siteId].astro` (pública, muestra las 4 fuentes
y permite votar `community`) y `src/pages/admin/site-trust/[siteId]/
self.astro` (dashboard, formulario de las 6 categorías `self`) son las
2 páginas que consumen esos endpoints — ver la sección "UI conectada"
para el detalle. Sigue pendiente: `agent` y `escrow_report` sin endpoint
ni UI, por falta de un mecanismo de autenticación real — ver "Endpoints
HTTP conectados".

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
debe pesar distinto. El schema y el tipo `AgentTrustVerification` hacen
esta distinción explícita con un campo `verified` separado del hecho de
que exista o no la fila.

**Por qué `escrow_report` es la señal más fuerte**: las otras 3 fuentes
son predictoras — intentan anticipar si un sitio es confiable. El reporte
de escrow es lo que **de verdad ocurrió** con una transacción real. No es
opinión ni verificación técnica, es el resultado factual. Un agente que
consulta esta fuente tiene la respuesta directa a la pregunta que más
importa en comercio: "¿este sitio entrega lo que promete?".

## Categorías por fuente

**`self`** (6): `gdpr_compliance`, `privacy_policy`, `terms_of_service`,
`payment_security`, `data_practices`, `contact_transparency`.

**`agent`** (5): `https_and_headers`, `structured_data_quality`,
`machine_readable_policies`, `content_freshness`, `bot_traffic_anomalies`.

**`community`** (4): `perceived_trustworthiness`, `content_accuracy`,
`spam_or_deceptive`, `responsiveness`.

**`escrow_report`** (1 campo, 3 valores posibles): `transaction_outcome`
∈ `completed_as_promised` | `refunded_no_delivery` | `disputed`.

Cada categoría vive en la fuente que puede evaluarla de verdad — pedirle a
un visitante humano que evalúe `https_and_headers` sería ruido sin
criterio; pedirle a un agente que evalúe `perceived_trustworthiness` no
tiene sentido porque un agente no tiene percepción subjetiva.

## Persistencia real: D1 y SQLite

`createSiteTrustScoreStore(env)` (packages/trust-layer/src/site-trust/
store-factory.ts) resuelve el backend igual que `createPermissionStore()`:
`env.DB` presente → `D1SiteTrustScoreStore` (Cloudflare Workers, usa
`D1DatabaseLike` para no acoplarse al binding real); `env.PORTALESS_SQLITE_PATH`
presente → `SqliteSiteTrustScoreStore` (self-hosted, `node:sqlite`, Node
22.5+); si ninguno está disponible, cae a `InMemorySiteTrustScoreStore` con
una advertencia explícita en consola — nunca falla en silencio.

Cada una de las 4 fuentes se escribe con su propio método
(`recordSelfEvaluation`, `recordAgentVerification`, `recordCommunityVote`,
`recordEscrowReport`), y ambos backends garantizan la fila en
`site_trust_subjects` antes de escribir en la tabla de la fuente
correspondiente (`ensureSubject`), ya que D1/SQLite no siempre fuerzan
foreign keys por defecto. `self` y `community` sobrescriben el valor más
reciente por categoría (u por categoría+votante); `agent` y
`escrow_report` insertan un registro histórico nuevo en cada llamada — un
sitio puede acumular múltiples verificaciones de agente o reportes de
escrow en el tiempo, y el historial completo importa (no solo el último
valor).

## Endpoints HTTP conectados

Tres endpoints conectan `createSiteTrustScoreStore` al mundo real, cada
uno con la audiencia y el nivel de auth que corresponde a quién puede
generar ese dato de verdad:

| Endpoint | Método | Auth | Quién lo usa |
|---|---|---|---|
| `/trust/:siteId` | GET | Ninguna (público) | Protocol APW, agentes externos, dashboard — lee el snapshot completo de las 4 fuentes |
| `/trust/:siteId/vote` | POST | Ninguna (público, `voterId` anónimo) | Visitantes humanos votando `community` |
| `/admin/site-trust/:siteId/self` | PUT | Sesión + rol `admin` (mismo patrón que `/admin/permissions`) | El propio admin del sitio, declarando `self` |

**Por qué `agent` y `escrow_report` no tienen endpoint todavía**: ambos
requieren un mecanismo de autenticación que no existe en el repo — `agent`
necesita verificar la identidad del agente verificador vía Web Bot Auth
(RFC 9421), y `escrow_report` necesita autenticar al tercero de escrow que
reporta (una API key o firma por proveedor, con una lista de proveedores
de confianza que tampoco existe todavía). Exponer estos dos sin ese
mecanismo significaría aceptar que cualquiera declare `verified: true` o
un `transaction_outcome` falso sobre cualquier sitio — el peor resultado
posible para las dos fuentes más objetivas del diseño.

## UI conectada

Dos páginas Astro consumen los 3 endpoints:

**`src/pages/trust/[siteId].astro`** — pública, sin auth. Consulta
`GET /trust/:siteId` y renderiza las 4 fuentes con la semántica visual
correcta para cada una: `self` muestra "Sin declarar" (neutral) cuando
falta una categoría; `agent` distingue explícitamente "Sin verificar"
(neutral) de "Verificación fallida" (badge rojo — la señal negativa real
de `verified: false`); `community` muestra el promedio 1-5 por categoría
y expone un formulario de voto (estrellas 1-5 + comentario opcional) que
llama a `POST /trust/:siteId/vote` con un `voterId` anónimo generado una
vez y persistido en `localStorage` del navegador; `escrow_report` lista
el historial completo de resultados (no solo el último), con un badge de
color distinto por resultado (`completed_as_promised` verde,
`refunded_no_delivery` naranja, `disputed` rojo).

**`src/pages/admin/site-trust/[siteId]/self.astro`** — protegida por
`functions/admin/_middleware.js` (sesión + rol admin). Un formulario por
categoría `self`, con checkbox + campo de URL de evidencia opcional, y un
botón "Guardar" independiente por fila que llama a
`PUT /admin/site-trust/:siteId/self`. Carga el estado inicial desde el
mismo `GET /trust/:siteId` público (no hay necesidad de un endpoint admin
de lectura separado, ya que el snapshot no tiene datos sensibles).

Ninguna de las dos páginas tiene todavía un link de navegación desde el
resto del dashboard — se acceden hoy solo escribiendo la URL directamente.

## Cómo se conecta con Protocol APW

`packages/apw-resolver/` (hoy stub, ver `docs/protocol-apw.md`) resuelve
identidad de un sitio vía `did:web`/DNS. Site Trust Score es el dato de
**confianza** que ese resolver expondría junto a la identidad — un agente
resolviendo un sitio antes de una transacción puede pedir específicamente
`agent.https_and_headers` + `agent.bot_traffic_anomalies` (las señales más
objetivas, verificables sin depender de opinión humana) para decidir si
avanza.

## Arquitectura de "confianza irrelevante" — el rol real de este score

Site Trust Score **no es** el mecanismo que hace que una transacción sea
segura. Es el **pre-filtro de eficiencia** que reduce cuánto necesitas
confiar antes de comprometerte a algo más costoso:

1. **Pre-filtro (este score)**: descarta sitios obviamente malos antes de
   gastar tiempo o recursos en verificación más profunda.
2. **Autorización** (fuera de este repo): un mandato criptográfico que
   limita lo que un agente puede gastar, en qué sitio, hasta cuándo.
3. **Ejecución con escrow real** (fuera de este repo, tercero): el dinero
   no va directo al sitio — va a custodia con condiciones de release
   (entrega confirmada → libera; no entrega → reembolso automático).
4. **Cierre** (`escrow_report`, este dominio): el resultado real de la
   transacción alimenta de vuelta el score — el sitio gana o pierde
   confianza según lo que efectivamente ocurrió, no según lo que declaró.

Los pasos 2 y 3 **no se construyen dentro de Portaless**, por la misma
razón ya documentada en `ROADMAP.md` ("Trust Layer y Pay per Crawl:
protocolo abierto, no asegurador"): garantizar un cobro real y custodiar
fondos requiere licencias financieras que corresponden a una entidad
regulada, no a este proyecto. Portaless expone el protocolo — el paso 4
es simplemente **recibir y almacenar** el reporte que un tercero de
escrow ya generó, nunca mover ni retener el dinero en sí.

## Limitaciones honestas

- No existe ningún endpoint HTTP ni UI para `agent` ni `escrow_report`
  todavía — ver "Endpoints HTTP conectados" para el porqué (falta un
  mecanismo de autenticación real para ambos).
- El endpoint `/trust/:siteId/vote` no implementa ningún rate-limiting ni
  prevención de abuso — `voterId` es una huella anónima autogenerada del
  lado del cliente (persistida en `localStorage`), y nada impide borrar
  ese storage y generar una nueva por request.
- Ninguna de las 2 páginas nuevas (`/trust/:siteId`,
  `/admin/site-trust/:siteId/self`) tiene todavía un link de navegación
  desde el resto del dashboard ni desde ningún otro punto del sitio — se
  acceden solo escribiendo la URL directamente.
- `packages/apw-resolver/` sigue siendo un stub — este score no está
  conectado a ninguna resolución real de `did:web` todavía, aunque ya es
  técnicamente consultable en `/trust/:siteId`.
- No se calcula todavía ningún promedio o resumen sobre `agent`/`escrow_report`
  (que acumulan historial) — la UI pública muestra la verificación más
  reciente por categoría y el historial completo de reportes de escrow,
  pero no calcula, por ejemplo, un "% de verificaciones exitosas".
