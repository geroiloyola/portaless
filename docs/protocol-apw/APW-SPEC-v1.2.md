# Protocol APW — Especificacion v1.2

**Autor**: Gerardo Loyola
**Proyecto**: Portaless
**Fecha**: Octubre 2026
**Estado**: implementacion de referencia en `main` (Portaless). Las secciones 5 (identidad e historial, v1.1) y 6 (Gobernanza de Lectura basada en Reputacion — Loyola Trust Protocol, v1.2) y el Anexo A estan implementados. Las correcciones normativas viven en [`ERRATA.md`](./ERRATA.md) (E-1 a E-9): **cuando una errata contradice este texto, manda la errata**. La seccion 7 es futuro.

**Historial de versiones**

| Version | Fecha | Contenido |
|---|---|---|
| [v1.0](./APW-SPEC-v1.0.md) | Septiembre 2026 | Diseno inicial, conservado sin cambios de fondo como anterioridad citable |
| v1.1 | Octubre 2026 | Identidad publica, firmas, atestaciones por emisor e historial encadenado (secciones 5.1 a 5.6 de este documento) |
| v1.2 | Octubre 2026 | Loyola Trust Protocol: autenticacion mutua y gobernanza de lectura (seccion 6), y puntuacion por dimensiones (Anexo A) |
| v1.2 + E-1..E-9 | Octubre 2026 | Implementacion de referencia completa de las secciones 5, 6 y Anexo A. Esta revision del documento marca el estado real y remite a las erratas |

[`apw-spec.md`](./apw-spec.md) queda reemplazado por este documento.

---

## 1. Tesis

Protocol APW reduce la responsabilidad operativa de quien publica un sitio al minimo indispensable — dominio, DNS y SSL — y usa el DNS como plano de control de identidad, version y confianza. El objetivo es **confianza verificable en un sitio sin autoridad central y legible por agentes de IA**, con un historial de reputacion que el sitio puede llevar consigo, que cualquier lector autorizado puede verificar y que el propio sitio gobierna.

## 2. Principios de diseno

1. **El sitio es la unidad de identidad.** `did:apw:<dominio>` identifica a un sitio o al operador de un agente, que tambien es un dominio. No identifica personas.
2. **El DNS es la raiz de confianza.** Quien controla el DNS del dominio controla la identidad. Todo lo demas (HTTPS, base de datos) es un canal secundario que debe coincidir con el DNS.
3. **La reputacion es por dimension y ponderada por quien evalua.** Ninguna entidad tiene un solo numero que la defina. Cada dimension se puntua de 1.0 a 7.0 y el peso de cada atestacion depende de la reputacion del emisor como evaluador (Anexo A).
4. **Portable significa firmado por quien emite.** Un dato de reputacion solo viaja fuera del sitio si lo firma su emisor con una clave publicada. Lo que no esta firmado es dato local.
5. **Portaless no es autoridad.** Cualquier implementacion que siga esta especificacion produce y verifica los mismos artefactos.
6. **La confianza es bidireccional.** Quien lee tambien se identifica y tambien tiene reputacion. El sitio decide quien puede leer sus datos de confianza (seccion 6).

## 3. Implementado (en `main`)

### 3.1 Base (anterior a v1.1)

| Pieza | Codigo | Que hace |
|---|---|---|
| Lectura DNS | `packages/apw-resolver/src/dns-txt/dns-txt.ts` | Lee `_apw.<dominio>` via DNS-over-HTTPS (Cloudflare 1.1.1.1). Funciona igual en edge y en Node. |
| Manifiesto | `packages/apw-resolver/src/manifest.ts` | Payload JSON compacto. v1 sin identidad; v2 con `k`, `h` y `rg` (5.1). `parseApwManifest()` nunca lanza y acepta ambas versiones. |
| Resolver | `packages/apw-resolver/src/index.ts` | `resolveApwManifest(domain)`: primer TXT que parsea como manifiesto valido. |
| Publicacion | `packages/apw-resolver/src/dnslink/cli.mjs` y el checklist de `/admin` (`functions/admin/api/apw-verification-status.js`) | Generan el valor exacto del TXT, con aviso si supera ~512 bytes. |
| SiteTrustScore | `packages/trust-layer/src/site-trust/site-trust-score.ts` | 4 fuentes (`self`, `agent`, `community`, `escrow_report`) con categorias cerradas y semantica de ausencia; `SiteTrustSnapshot` sin promedio. |
| Escritura por fuente | `PUT /admin/site-trust/:siteId/self`, `POST /trust/:siteId/vote`, `POST /trust/:siteId/agent-verification`, `POST /trust/:siteId/escrow-report` | Sesion admin; anonimo con rate limit por `ipHash`; Web Bot Auth + allowlist `authorized_agents`; API key + allowlist `authorized_escrow_providers`. |
| Identidad de agentes | `packages/trust-layer/src/webbotauth/` (draft-03, compartido por middleware y SiteTrustScore) | Verifica quien hace cada request: es la identidad del lector en la seccion 6. |
| Ledger | Trust Layer (`usage_ledger`) | Registra accesos verificados y violaciones de politica por agente, y desde E-9 el DID candidato del lector (`reader_did`). |

### 3.2 Secciones 5 y 6 (v1.1 y v1.2)

| Pieza | Codigo | Errata |
|---|---|---|
| Identidad `did:apw` con historial de claves (`keyId` `#key-<n>`, huella, ventanas `validFrom`/`validTo`) | `did-apw/generate.ts`, `site-identity-store.ts`, `key-id.ts`, `fingerprint.ts` | E-1, E-3 |
| `GET /.well-known/did.json` y verificacion TXT contra `did.json` | `functions/.well-known/did.json.js`, `resolveApwIdentity()` | E-1 |
| JWS del sitio con JCS y manifiesto extendido `GET /.well-known/apw-manifest.jws` | `did-apw/site-jws.ts`, `site-manifest.ts` | E-5 |
| Atestaciones verificables `agent`, `escrow_report`, `self` | `trust-layer/src/site-trust/attestation.ts`, endpoints de `/trust/:siteId/*` | E-4, E-5 |
| Historial encadenado firmado y `GET /.well-known/apw-log.json` | `did-apw/history-log.ts`, `history-resolver.ts`, `attestation-log-store.ts` | E-2, E-3 |
| Paquete de atestaciones `GET /.well-known/apw-attestations.json` | historial con `att_jws` | E-9 |
| Puntuacion por dimensiones y calibracion R-05 | `scoring/scoring.ts` | E-6, E-7 |
| Politica de lectura, identidad del lector y enforcement fail-closed | `scoring/read-policy-store.ts`, `reader-identity.ts`, `policy.ts`, `functions/trust/[siteId].js` | E-8 |
| Reputacion del lector (`reader_conduct`) con completitud, y emision desde el ledger | `scoring/reader-attestations.ts`, `reader-conduct-emitter.ts`, `reader-conduct-config.ts`, `functions/admin/api/reader-conduct/emit.js` | E-9 |

## 4. Estado de las brechas

Tabla original de v1.2 con su estado actual.

| # | Brecha original | Estado | Como se cerro |
|---|---|---|---|
| B1 | El documento DID no es publico | Cerrada | `GET /.well-known/did.json` (5.1, E-1). |
| B2 | El TXT publicado no incluye identidad | Cerrada | Manifiesto v2 con `k`, `h` y `rg` (5.1). |
| B3 | La clave del sitio nunca firma nada | Cerrada | JWS del sitio, manifiesto extendido, entradas del historial y `self` (5.2, E-3, E-5). |
| B4 | La verificacion de un agente no es re-verificable | Cerrada | Atestacion firmada con la clave del directorio Web Bot Auth del agente (5.3, E-4). |
| B5 | Los reportes de escrow no son verificables por terceros | Cerrada | Atestacion firmada con la clave publica registrada del proveedor (5.3, E-4). |
| B6 | El historial se puede editar sin rastro | Cerrada | Historial encadenado anclado con `h` en el DNS (5.4, E-2). No detecta omisiones (seccion 7). |
| B7 | `community` no tiene identidad de votante | Abierta | Sigue fuera de la cadena (5.3); requiere identidad de votante (seccion 7). |
| B8 | El voto fallaba en self-host | Cerrada | Corregido en el PR que publico esta especificacion. |
| B9 | La reputacion es de lectura publica y unidireccional | Cerrada con limites | Politica de lectura (E-8) y reputacion del lector (E-9). Omision en el origen y *equivocation* requieren testigos (seccion 7). |

## 5. Identidad e historial (v1.1)

### 5.1 Resolucion de `did:apw` (cierra B1 y B2)

`did:apw:<dominio>` se resuelve por **dos canales que deben coincidir**:

1. **DNS (raiz de confianza).** El manifiesto en `_apw.<dominio>` agrega el campo `k`: huella de la clave publica activa. Ocupa 43 caracteres y deja margen dentro de los ~512 bytes. *(E-1: `k` es el JWK Thumbprint de RFC 7638, no `SHA-256(JCS(publicKeyJwk))`.)*
2. **HTTPS (documento completo).** `GET https://<dominio>/.well-known/did.json` devuelve el `didDocument` publico (sin clave privada), con el mismo formato que `did:web`.

Un resolver considera valida la identidad solo si la huella de la clave del `did.json` es igual a `k` del TXT. Si no coinciden, la identidad es invalida: el canal HTTPS no puede suplantar al DNS. Rotar la clave implica actualizar el TXT; las claves anteriores siguen publicadas con su ventana de validez (E-2, E-3).

Manifiesto v2. El resolver acepta v1 y v2: un manifiesto v1 sigue siendo valido, pero sin identidad verificable. El campo `rg` se define en 6.5.

```json
{"v":2,"siteId":"ejemplo.com","trustUrl":"/trust/ejemplo.com","contentKinds":["mixed"],"k":"<huella>","h":"<cabeza>","rg":true}
```

### 5.2 Firma de artefactos del sitio (cierra B3)

Todo artefacto firmado por el sitio es un **JWS compacto** (RFC 7515) con `alg: "EdDSA"`, cuyo payload es JSON canonicalizado con JCS. El primer artefacto es el **manifiesto extendido**, servido en `/.well-known/apw-manifest.jws`, que repite los campos del TXT mas metadatos que no entran en el DNS.

*(E-3 y E-5: `kid` es el `keyId` de la clave activa, `did:apw:<dominio>#key-<n>`, no un `#key-1` fijo. E-5 fija el `typ`, el payload del manifiesto y la verificacion JCS estricta.)*

### 5.3 Atestaciones firmadas por el emisor (cierra B4 y B5)

Una atestacion es un JWS emitido por quien genera el dato, nunca por el sitio evaluado:

```json
{
  "typ": "apw-attestation+jws",
  "iss": "<identidad del emisor>",
  "sub": "did:apw:<dominio>",
  "src": "agent | escrow_report | self | reader_conduct",
  "cat": "<categoria o transaction_outcome>",
  "val": true,
  "iat": 1790000000,
  "jti": "<identificador unico>"
}
```

- **`agent`**: `iss` es el origen `Signature-Agent` del agente y la firma usa **la misma clave Ed25519 que ya publica en su directorio Web Bot Auth**. El endpoint `/trust/:siteId/agent-verification` mantiene sus dos capas (identidad + allowlist) y ademas exige la atestacion en el cuerpo, verificada contra la clave del directorio.
- **`escrow_report`**: `iss` es el `provider_id`; `authorized_escrow_providers` guarda la clave publica del proveedor. La API key sigue autenticando el endpoint; la firma es la prueba exportable.
- **`self`**: la firma el sitio con su propia clave (5.2). Sigue siendo la senal mas debil, ahora atribuible.
- **`community`**: queda **fuera de la cadena** (B7). Se sigue mostrando como dato local, marcado como no verificable.
- **`reader_conduct`**: ver 6.4.

El servidor guarda el JWS completo junto a la fila existente del `SiteTrustScoreStore`; no se crea un store paralelo. *(E-4 define la entrega en `body.attestation`, el orden de validaciones, la ventana de `iat` y la unicidad de `jti`.)*

### 5.4 Historial encadenado (cierra B6)

Cada atestacion aceptada se agrega a un log del sitio. Cada entrada es un JWS firmado por el sitio con payload `{ seq, prev, att, ts }`, donde `prev` es el hash de la entrada anterior y `att` el hash del JWS del emisor. El hash de la ultima entrada se publica como `h` en el TXT.

- Detecta alteracion o borrado de entradas ya publicadas: cambia la cadena y deja de coincidir con `h`.
- **No detecta omisiones**: un sitio puede no aceptar una atestacion desde el inicio. La proteccion contra omisiones requiere testigos externos (seccion 7).

*(E-2 fija hashes, primera entrada, `ts`, publicacion en `/.well-known/apw-log.json`, rotacion y anclaje. E-9 agrega el JWS completo de cada atestacion junto a la entrada.)*

### 5.5 Exportacion y verificacion

- La cadena se publica en `GET /.well-known/apw-log.json` (E-2) y los JWS de cada emisor en `GET /.well-known/apw-attestations.json` (E-9). *Reemplaza al `GET /trust/:siteId/attestations` previsto originalmente.*
- `resolveApwHistory(domain)` en `apw-resolver` resuelve el TXT, verifica `k` contra la clave activa del log, recorre la cadena y comprueba el anclaje de `h`. Devuelve un resultado y nunca lanza. La verificacion de cada atestacion contra la clave de su emisor la hace `loadReaderConduct()` para `reader_conduct` (E-9). *(El nombre `verifyApwHistory()` de la version original corresponde a estas dos funciones.)*

### 5.6 Vectores de prueba

La especificacion se publica con vectores fijos (claves, payloads, JWS, hashes y puntajes del Anexo A) para que otra implementacion pueda comprobar compatibilidad sin depender del codigo de Portaless. Los vectores vigentes estan en E-1 (huellas) y E-6/E-7 (puntajes); los de JWS e historial viven en los tests de `apw-resolver`.

## 6. Gobernanza de Lectura basada en Reputacion — Loyola Trust Protocol (v1.2)

### 6.1 Problema (cierra B9)

La web es asimetrica: los rastreadores identifican, perfilan y califican a los sitios, pero los sitios no pueden identificar ni calificar a quien los lee. Con v1.1 el historial de reputacion de un sitio es publico: cualquiera puede armar una base de datos de "los mejores sitios" sin permiso ni contrapartida.

### 6.2 Concepto

El **Loyola Trust Protocol** (Reputacion de Confianza Mutua) usa la identidad APW en ambas direcciones:

1. El sitio define politicas de lectura sobre sus recursos de confianza y, mas adelante, de contenido.
2. Quien lee (agente de IA, indice, otro sitio) se autentica con Web Bot Auth y su origen `Signature-Agent` se resuelve a `did:apw:<dominio-del-lector>`.
3. El sitio verifica el historial APW del lector (5.5), calcula sus dimensiones (Anexo A) y evalua la politica. Solo si se cumple, entrega el recurso; si no, responde segun `on_fail`.

El resultado son **Trust Enclaves**: conjuntos de sitios y lectores que solo se exponen datos entre si cuando ambas partes prueban identidad y reputacion. Casos tipicos: indices que solo leen sitios que los aceptan, redes de medios independientes que comparten historial solo entre periodistas verificados, y sitios que no se dejan perfilar por rastreadores anonimos.

### 6.3 Identidad del lector

- El lector se identifica con Web Bot Auth (draft-03), implementado en `webbotauth/verify.ts`.
- Su origen `Signature-Agent` (por ejemplo `https://indice.example`) se mapea a `did:apw:indice.example`, que se resuelve igual que el de un sitio (5.1).
- La clave que firma la request Web Bot Auth debe tener la misma huella que `k` en el TXT del lector. Asi la identidad del agente y la identidad APW quedan unificadas: un par de claves por dominio. *(E-8: por ahora solo se acepta la clave activa `k`; las claves no activas del `did.json` quedan fuera.)*
- Un lector sin identidad APW puede autenticarse por Web Bot Auth, pero no tiene reputacion: cualquier politica que exija reputacion lo rechaza.

### 6.4 Reputacion del lector: atestaciones `reader_conduct`

Para que un lector tenga reputacion, alguien tiene que emitirla. v1.2 agrega la fuente **`reader_conduct`**, que emite un sitio sobre un lector despues de interactuar con el:

```json
{
  "typ": "apw-attestation+jws",
  "iss": "did:apw:<sitio-emisor>",
  "sub": "did:apw:<lector>",
  "src": "reader_conduct",
  "cat": "respected_policy | rate_respected | paid_as_agreed | redistribution | policy_violation",
  "val": true,
  "iat": 1790000000,
  "jti": "<identificador unico>"
}
```

- La firma el sitio emisor con su clave (5.2). Se agrega al historial del emisor (registro de lo emitido) y se entrega al lector, que la incorpora a su propio historial.
- `policy_violation` y `redistribution` con `val: true` son senales negativas reales, con la misma semantica que `agent.verified: false`. Un lector no puede borrarlas de su historial sin romper la cadena ni ocultarlas sin romper la completitud (E-9); si no las acepta, el emisor las conserva y puede exponerlas a otros sitios de su enclave.
- El ledger del Trust Layer es la fuente para emitirlas. *(E-9: emision por periodo con `POST /admin/api/reader-conduct/emit`, admin + step-up, `jti` determinista, solo si la clave del lector es `k` de su TXT. Hoy se emiten `respected_policy` y `policy_violation`; `rate_respected`, `paid_as_agreed` y `redistribution` esperan datos del ledger.)*

### 6.5 Politicas de lectura

Una politica es un **conjunto de predicados sobre dimensiones** (Anexo A), evaluado sobre el historial del lector:

```json
{
  "resource": "/trust/*",
  "action": "read",
  "require": {
    "identity": "apw_verified",
    "R-01": { "min": 5.0, "min_weight": 2.0 },
    "R-05": { "min": 5.0, "min_weight": 2.0 }
  },
  "on_fail": "403"
}
```

- Recursos gobernables: `GET /trust/:siteId`. En una version posterior, cualquier ruta de contenido, combinandose con la politica `allow`/`charge`/`block` del Trust Layer.
- `on_fail: "402"` se integra con el settlement de pay-per-crawl: el dueno puede permitir compensar la confianza faltante con pago.
- El manifiesto solo anuncia `rg: true`; publicar la politica completa le diria a un atacante exactamente que fabricar.

*(E-8 reemplaza el almacenamiento: la politica vive en la tabla tipada `site_trust_read_policies`, no en el Centro de Permisos; este queda para excepciones por lector, `trust:read-governance-bypass`, todavia sin implementar. E-9: R-05 arranca desactivado en `reader-conduct-config.ts` hasta que haya evaluadores suficientes para calibrar.)*

### 6.6 Que sigue siendo publico

- El TXT (`k`, `h`, `rg`), `did.json`, el manifiesto extendido, el log y el paquete de atestaciones siempre son publicos: sin ellos nadie podria verificar nada.
- `h` es un compromiso publico sobre el historial: revela que existe y que cambio, no su contenido. Un lector autorizado comprueba que lo recibido coincide con `h`.
- Las dimensiones de nivel publico (Anexo A.6) y el puntaje, la cantidad y la suma de pesos de todas las dimensiones. *(E-8: al rechazar, la proyeccion de las dimensiones W publicas sigue pendiente; hoy se devuelve `verification` y la cantidad de filas por fuente.)*

### 6.7 Arranque en frio e identidades falsas

- **Arranque en frio**: un lector nuevo empieza con todas sus dimensiones en 4.0 y peso de evaluador 0.25 (Anexo A.4.2). Gana reputacion leyendo recursos de sitios con politicas laxas o publicas. Por eso el valor por defecto de un sitio es publicar el nivel publico completo.
- **Identidades falsas (Sybil)**: un atacante puede registrar muchos dominios y emitirse atestaciones entre ellos. Defensas exigidas:
  - **Ponderacion por quien evalua** (Anexo A.4.2): un dominio nuevo pesa 0.25 y solo gana peso si sus evaluaciones coinciden con el consenso de emisores ya ponderados.
  - Contar solo emisores **distintos** y exigir suma de pesos minima en cada predicado (`min_weight`). Las atestaciones de un lector sobre si mismo no cuentan (E-9).
  - Antiguedad minima del historial del emisor (dimension W-07).
  - Ponderar `escrow_report` (terceros regulados) por encima de `reader_conduct` cuando la politica lo requiera.
- Ninguna defensa es perfecta: un atacante con suficientes dominios antiguos y bien calibrados puede construir reputacion. El costo de hacerlo es la defensa, como en cualquier red de confianza.

### 6.8 Implementacion sobre lo existente

| Pieza | Reutiliza | Agrega |
|---|---|---|
| Autenticacion del lector | `webbotauth/verify.ts` (draft-03) | Mapeo `Signature-Agent` -> `did:apw` y comprobacion de la clave contra `k` (`reader-identity.ts`) |
| Reputacion del lector | `resolveApwHistory()` (5.5), con cache por TTL | `reader_conduct` con completitud (`reader-attestations.ts`), emision desde el ledger (`reader-conduct-emitter.ts`) y calculo de dimensiones R |
| Politicas | Tabla tipada `site_trust_read_policies` (E-8) | Evaluador de predicados (`policy.ts`) |
| Enforcement | `functions/_middleware.js` y `functions/trust/[siteId].js` | Respuestas 401, 403 o 402; nunca abre por defecto |
| 402 | `billing/pay-per-crawl/` | `on_fail: "402"` |

### 6.9 Limites

- La gobernanza protege lo que el sitio sirve gobernado. El contenido abierto (HTML publico, `llms.txt`) sigue siendo legible salvo que tambien se gobierne.
- Un lector autorizado puede copiar y redistribuir lo que lee. El protocolo puede registrar esa conducta (`redistribution`) si se detecta; no puede impedirla.
- Verificar reputacion en cada request agrega latencia: requiere cache, y si el historial del lector no se puede resolver se aplica `on_fail`. Nunca se abre por defecto.
- La completitud de E-9 prueba que el lector no oculto atestaciones **ya anotadas**. No prueba que haya anotado todas las que recibio ni que muestre la misma cadena a todos (seccion 7).

## 7. Futuro (fuera de la implementacion actual)

- **Testigos externos y Portaless Index**: terceros que guardan copias de `h` en el tiempo, para detectar omisiones, reescrituras del TXT y *equivocation* (cadenas distintas para distintos visitantes). Index es tambien el primer lector natural de los enclaves.
- **Automatizar el anclaje de `h`**: hoy el TXT se actualiza a mano y las entradas posteriores quedan sin anclar (E-2).
- **`community` portable** (B7): requiere identidad de votante con resistencia a identidades falsas.
- **Excepciones por lector**: grant `trust:read-governance-bypass` (E-8).
- **Claves no activas del lector**: aceptar firmas con claves retiradas dentro de su ventana (E-8).
- **R-05 en politicas**: activarlo cuando haya evaluadores suficientes (E-9).
- **Nuevas senales de conducta**: `rate_respected`, `paid_as_agreed`, `redistribution` (6.4).
- **Gobernanza de contenido**: extender 6.5 a cualquier ruta, no solo `/trust/*`.
- **ML-DSA (FIPS 204)** en las firmas APW del sitio y de los emisores. La verificacion ML-DSA ya existe para la identidad Web Bot Auth de la fuente `agent`, pero E-4 sigue exigiendo Ed25519 en las atestaciones.
- **Portaless Cloud Images**: el mismo formato de atestacion aplicado a imagenes.

*(El "historial de claves" listado aqui en la version original ya esta implementado: E-2 y E-3.)*

## 8. Limites generales

- La identidad prueba control del DNS, no veracidad del contenido.
- Un sitio puede omitir atestaciones que no le convienen hasta que existan testigos.
- Si se compromete la clave del sitio, el atacante puede firmar entradas nuevas hasta que se rote y se actualice el TXT.
- `ts` lo declara quien firma la entrada: con una clave comprometida se pueden fechar entradas dentro de la ventana de esa clave (E-2, E-9).
- `community` sigue siendo inflable hasta que exista identidad de votante.
- APW comparte primitivas con protocolos federados (identificadores DID, registros firmados, historial verificable), pero no define todavia una capa de sincronizacion entre nodos; esa capa corresponde a Portaless Index.

---

## Anexo A — Puntuacion por dimensiones

Adaptado del Sistema de Scoring Universal de Veranet (Gerardo Loyola) al dominio de sitios web y agentes de IA. Las atestaciones firmadas (5.3) son la materia prima; las dimensiones son como se leen. Las cuatro fuentes no desaparecen: son la procedencia de cada atestacion. Implementacion: `packages/apw-resolver/src/scoring/scoring.ts`.

### A.1 Principios

1. **Separacion por dimension.** Cada dimension es un puntaje independiente.
2. **Escala universal 1.0 a 7.0.** 4.0 es neutral: es el valor de una entidad sin historial.
3. **Ponderacion por quien evalua.** El peso de una atestacion depende de la dimension R-05 del emisor.
4. **Transparencia total.** Cualquiera con acceso puede recalcular cada puntaje a partir de las atestaciones firmadas y de estas formulas.
5. **Indestructibilidad.** Un puntaje nunca se borra; solo cambia con nuevas atestaciones. El historial encadenado (5.4) lo garantiza.
6. **Solo dominios.** El modelo califica sitios, indices y operadores de agentes. No califica personas.

### A.2 Dimensiones de un sitio (W)

| ID | Dimension | Senales (peso) | Fuentes |
|---|---|---|---|
| W-01 | Seguridad tecnica | HTTPS y headers (60%), ausencia de anomalias de trafico (40%) | `agent`: `https_and_headers`, `bot_traffic_anomalies` |
| W-02 | Veracidad del contenido | Precision percibida (60%), correcciones publicadas (40%, nueva) | `community`: `content_accuracy`; `agent` (futuro) |
| W-03 | Transparencia | Contacto y responsables (40%), terminos publicados (30%), respuesta a reclamos (30%) | `self`: `contact_transparency`, `terms_of_service`; `community`: `responsiveness` |
| W-04 | Privacidad y datos | Politica de privacidad y GDPR (50%), practicas de datos verificadas (50%) | `self`: `privacy_policy`, `gdpr_compliance`, `data_practices`; `agent` (futuro: trackers) |
| W-05 | Cumplimiento comercial | Transacciones completadas (60%), disputas resueltas (25%), seguridad de pago declarada (15%) | `escrow_report`; `self`: `payment_security` |
| W-06 | Legibilidad para agentes | Datos estructurados (40%), politicas legibles por maquina (40%), `llms.txt` y markdown (20%) | `agent`: `structured_data_quality`, `machine_readable_policies` |
| W-07 | Continuidad | Frescura del contenido (50%), antiguedad del historial APW (50%) | `agent`: `content_freshness`; primera entrada del historial |
| W-08 | Procedencia | Origen declarado humano/IA (50%), coincidencia con lo observado (50%) | `self` (nueva categoria); `agent`/`community` (futuro) |
| W-09 | Coherencia | Divergencia entre lo declarado (`self`) y lo verificado por terceros (`agent`, `escrow_report`) | Derivada (A.5) |
| W-10 | Integridad | Ausencia de spam o engano (100%) | `community`: `spam_or_deceptive` |

### A.3 Dimensiones de un lector (R)

| ID | Dimension | Senales | Equivalente Veranet |
|---|---|---|---|
| R-01 | Respeto de politicas | `respected_policy` frente a `policy_violation` | S-13 Etico |
| R-02 | Respeto de tasa | `rate_respected` | S-11 Respeto |
| R-03 | Cumplimiento de pago | `paid_as_agreed` | S-04 Comprador, S-15 Financiero |
| R-04 | Discrecion | no redistribuir datos gobernados (`redistribution`) | S-18 Privacidad ajena |
| R-05 | Justicia como evaluador | calibracion de sus atestaciones respecto del consenso ponderado (A.4.3) | S-14 Justicia |

Un dominio puede tener dimensiones W y R a la vez: un sitio tambien lee y evalua a otros.

### A.4 Calculo

#### A.4.1 Valor de una atestacion

Cada atestacion aporta un valor `v` en 1.0 a 7.0 a una dimension. Las atestaciones booleanas se mapean asi: positiva = 7.0, negativa = 1.0. Los votos `community` (1 a 5) se reescalan linealmente a 1.0 a 7.0.

#### A.4.2 Peso del emisor

```
w = ((J - 1) / 6) ^ 2
```

`J` es la dimension R-05 del emisor. Un emisor nuevo tiene J = 4.0 y w = 0.25. Un emisor con J = 6.7 tiene w = 0.9025: su opinion pesa 3.61 veces mas. Un emisor con J = 1.0 tiene w = 0. La atestacion `self` tiene peso fijo 0.25 y nunca alimenta el R-05 propio.

#### A.4.3 Puntaje de una dimension

Promedio bayesiano ponderado, con previo neutral:

```
S = (P * 4.0 + suma(w_i * v_i)) / (P + suma(w_i))
```

con `P = 3`. Con pocas atestaciones el puntaje queda cerca de 4.0: una sola resena no lleva a nadie a un extremo.

R-05 mide la desviacion de cada atestacion del emisor respecto del consenso: cuanto menor la desviacion media, mayor J. Un emisor que ataca sistematicamente pierde peso y sus ataques siguientes valen menos. *(E-7 fija la regla: `J = max(1, 7 - 1.5 x d)`, desviacion contra el promedio ponderado de los demas emisores sin el previo P (leave-one-out), calculado por punto fijo.)*

#### A.4.4 Ejemplo (calculado con las formulas anteriores; corregido por E-6)

- El sitio A tiene **6.095** en W-10, con 10 atestaciones de 7.0 de emisores con J = 6.0 (w = 0.694). Un emisor con J = 4.0 lo ataca con un 1.0: A baja a **5.970** (-2.05%).
- El sitio B tiene 4.00 en W-10, con 10 atestaciones de emisores con J = 5.0 (w = 0.44). Un emisor con J = 6.7 dice que merece un 3.0: B baja a **3.892**. Con un 1.0, baja a **3.676** (-8%).
- Por cada punto de desviacion, la opinion del emisor de 6.7 mueve el puntaje 3.61 veces mas que la del emisor de 4.0.

`P`, el exponente 2, el peso de `self` y el factor de E-7 son valores por defecto de esta version; se pueden ajustar en versiones futuras con nuevos vectores de prueba.

#### A.4.5 Confianza

Cada dimension se publica con su puntaje, la cantidad de atestaciones y la suma de pesos. Un 6.5 con suma de pesos 0.5 no significa lo mismo que un 6.5 con suma de pesos 40.

### A.5 Meta-indicadores

| Indicador | Calculo | Que revela |
|---|---|---|
| Indice de Coherencia (W-09) | Diferencia media entre lo declarado en `self` y lo verificado por terceros en las mismas categorias | Un sitio que dice cumplir GDPR pero los agentes encuentran trackers |
| Indice de Estabilidad | Varianza historica de las dimensiones | Si la entidad es predecible o erratica |
| Indice de Confianza orientativo | Promedio ponderado de las dimensiones | Cifra orientativa; nunca se usa por si sola en politicas |

### A.6 Que es publico y que es gobernado

Criterio: lo que cualquier rastreador puede comprobar por su cuenta no gana privacidad al ocultarse; lo que proviene de relaciones (votos, transacciones, conducta) si.

| Nivel | Dimensiones | Quien lo ve |
|---|---|---|
| **Publico (siempre)** | W-01, W-04, W-06, W-07, W-09, y de cada dimension: puntaje, cantidad y suma de pesos | Cualquiera |
| **Gobernado (por defecto)** | W-02, W-03, W-05, W-08, W-10, todas las R, y las atestaciones individuales con sus comentarios | Lectores con identidad APW que cumplan la politica del sitio |

Politica por defecto para el nivel gobernado: identidad APW verificada, R-01 >= 5.0 y R-05 >= 5.0, cada una con suma de pesos >= 2.0. El dueno puede endurecerla o volver publico cualquier dato gobernado, pero no puede ocultar el nivel publico: un sitio que esconde su seguridad tecnica no gana privacidad, pierde verificabilidad. *(E-9: mientras R-05 este desactivado, la politica por defecto exige solo R-01.)*
