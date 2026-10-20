# Protocol APW — Especificacion Normativa v1.3

> **ARCHIVO HISTÓRICO (español).** La especificación normativa canónica y vigente está en inglés en [`APW-SPEC-v1.3.md`](./APW-SPEC-v1.3.md). Esta copia en español se conserva íntegra por contexto y traducción; ante cualquier discrepancia (números, fórmulas, keywords) manda la versión en inglés.
>
> El suplemento normativo SVRI v1.0 (ERRATA E-16) tiene documento canónico propio en [`SVRI-v1.0.md`](./SVRI-v1.0.md).

**Autor**: Gerardo Loyola
**Proyecto**: Portaless
**Fecha**: Octubre 2026
**Licencia**: CC BY 4.0 (ver [Licencia y gobernanza](#licencia-y-gobernanza))
**Estado**: documento normativo unico. Consolida v1.0 (diseno), v1.1 (identidad e historial), v1.2 (seccion 6, hoy Loyal Trust Protocol) y las correcciones E-1 a E-10 de [`ERRATA.md`](./ERRATA.md), que aqui estan **integradas en el texto**. Cuando este documento y cualquier version anterior discrepen, manda v1.3. Los vectores de prueba fijos viven en [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md), en un archivo independiente del codigo: una implementacion ajena a Portaless puede comprobar compatibilidad sin leer ni ejecutar este repositorio.

**Palabras normativas**: *debe*, *debe solo*, *nunca* indican requisito; *puede* indica opcion; *hoy* marca una limitacion temporal de la implementacion de referencia.

**Historial de versiones**

| Version | Fecha | Contenido |
|---|---|---|
| [v1.0](./APW-SPEC-v1.0.md) | Septiembre 2026 | Diseno inicial, conservado sin cambios de fondo como anterioridad citable |
| v1.1 | Octubre 2026 | Identidad publica, firmas, atestaciones por emisor e historial encadenado (secciones 5.1 a 5.6) |
| v1.2 | Octubre 2026 | Seccion 6 (autenticacion mutua y gobernanza de lectura; publicada entonces como "Loyola Trust Protocol", hoy Loyal Trust Protocol) y puntuacion por dimensiones (Anexo A) |
| v1.2 + E-1..E-9 | Octubre 2026 | Implementacion de referencia completa de las secciones 5, 6 y Anexo A, con las correcciones en [`ERRATA.md`](./ERRATA.md) |
| **v1.3 (esta)** | Octubre 2026 | Consolidacion normativa: E-1 a E-9 integradas en el cuerpo; vectores de prueba separados del codigo. Posteriormente se integro E-10 (testigos, seccion 5.7) y la emision automatica de `reader_conduct` (6.4) |

[`apw-spec.md`](./apw-spec.md) y [`APW-SPEC-v1.2.md`](./APW-SPEC-v1.2.md) quedan reemplazados por este documento.

---

## Licencia y gobernanza

**Licencia del estandar.** Este documento, [`ERRATA.md`](./ERRATA.md) y [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) se publican bajo **CC BY 4.0**: copiar, traducir, reimplementar y usar comercialmente esta especificacion es permitido, con atribucion al autor. La implementacion de referencia (codigo de Portaless en este repositorio) es **AGPL-3.0** (ver [`LICENSE`](../../LICENSE) y [`docs/architecture/licensing-boundaries.md`](../architecture/licensing-boundaries.md)): la licencia del estandar no contagia al codigo, ni la licencia del codigo al estandar.

**Autoria y edicion.** Autor: Gerardo Loyola. El proyecto Portaless edita y publica las versiones de este documento. El Anexo A adapta el Sistema de Scoring Universal de Veranet, del mismo autor; eso no restringe reimplementar el Anexo A.

**Nombre.** La seccion 6 se llama **Loyal Trust Protocol (LTP)**. Versiones anteriores del documento la publicaron como "Loyola Trust Protocol": misma especificacion, mismo acronimo LTP. Al citar, usar el nombre con que se publico la version citada.

**Neutralidad y conformidad.** Este documento no exige registro, permiso, certificacion ni licenciamiento de marca para implementarlo. Cualquier proyecto puede implementar Protocol APW, LTP o cualquiera de sus partes, citarlas y declarar conformidad sin relacion con Portaless. Declarar conformidad minima significa: publicar los artefactos que este documento exige y pasar los vectores minimos (V-01, V-03, V-05, V-06, V-08, V-09) citando su ID. Ningun texto fuera de este documento ni de `ERRATA.md` es normativo (principio 5, seccion 2).

**Proceso de cambios.**

1. *Erratas* (`E-n` en [`ERRATA.md`](./ERRATA.md)): correcciones, precisiones y cierres de limitaciones. Una errata publicada es vigente aunque aun no este integrada en el cuerpo de una version; la consolidacion siguiente la integra y la version mas nueva manda.
2. *Versiones* (`v1.x`): cambios normativos con fecha y fila en el historial de arriba. Ante discrepancia entre documentos, manda la version mas nueva.
3. *Propuestas*: cambios se discuten como issues o PRs en el repositorio de Portaless antes de volverse normativos. Lo que no esta en este documento ni en `ERRATA.md` es informacion, no requisito.

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
7. **Fail-closed.** Toda verificacion de identidad, firma, cadena o politica que no se puede completar se trata como fallo: se rechaza o se aplica `on_fail`. Nunca se abre por defecto.

## 3. Alcance e implementacion de referencia

### 3.1 Base

| Pieza | Codigo | Que hace |
|---|---|---|
| Lectura DNS | `packages/apw-resolver/src/dns-txt/dns-txt.ts` | Lee `_apw.<dominio>` via DNS-over-HTTPS (Cloudflare 1.1.1.1). Funciona igual en edge y en Node. |
| Manifiesto | `packages/apw-resolver/src/manifest.ts` | Payload JSON compacto. v1 sin identidad; v2 con `k`, `h` y `rg` (5.1). `parseApwManifest()` nunca lanza y acepta ambas versiones. |
| Resolver | `packages/apw-resolver/src/index.ts` | `resolveApwManifest(domain)`: primer TXT que parsea como manifiesto valido. |
| Publicacion | `packages/apw-resolver/src/dnslink/cli.mjs` y el checklist de `/admin` (`functions/admin/api/apw-verification-status.js`) | Generan el valor exacto del TXT, con aviso si supera ~512 bytes. |
| SiteTrustScore | `packages/trust-layer/src/site-trust/site-trust-score.ts` | 4 fuentes (`self`, `agent`, `community`, `escrow_report`) con categorias cerradas y semantica de ausencia; `SiteTrustSnapshot` sin promedio. |
| Escritura por fuente | `PUT /admin/site-trust/:siteId/self`, `POST /trust/:siteId/vote`, `POST /trust/:siteId/agent-verification`, `POST /trust/:siteId/escrow-report` | Sesion admin; anonimo con rate limit por `ipHash`; Web Bot Auth + allowlist `authorized_agents`; API key + allowlist `authorized_escrow_providers`. |
| Identidad de agentes | `packages/trust-layer/src/webbotauth/` (draft-03, compartido por middleware y SiteTrustScore) | Verifica quien hace cada request: es la identidad del lector en la seccion 6. |
| Ledger | Trust Layer (`usage_ledger`) | Registra accesos verificados y violaciones de politica por agente, y el DID candidato del lector (`reader_did`). |

### 3.2 Secciones 5 y 6

| Pieza | Codigo | Requisitos |
|---|---|---|
| Identidad `did:apw` con historial de claves (`keyId` `#key-<n>`, huella, ventanas `validFrom`/`validTo`) | `did-apw/generate.ts`, `site-identity-store.ts`, `key-id.ts`, `fingerprint.ts` | 5.1, 5.4 |
| `GET /.well-known/did.json` y verificacion TXT contra `did.json` | `functions/.well-known/did.json.js`, `resolveApwIdentity()` | 5.1 |
| JWS del sitio con JCS y manifiesto extendido `GET /.well-known/apw-manifest.jws` | `did-apw/site-jws.ts`, `site-manifest.ts` | 5.2 |
| Atestaciones verificables `agent`, `escrow_report`, `self` | `trust-layer/src/site-trust/attestation.ts`, endpoints de `/trust/:siteId/*` | 5.3 |
| Historial encadenado firmado y `GET /.well-known/apw-log.json` | `did-apw/history-log.ts`, `history-resolver.ts`, `attestation-log-store.ts` | 5.4 |
| Paquete de atestaciones `GET /.well-known/apw-attestations.json` | historial con `att_jws` | 5.5 |
| Puntuacion por dimensiones y calibracion R-05 | `scoring/scoring.ts` | Anexo A |
| Politica de lectura, identidad del lector y enforcement fail-closed | `scoring/read-policy-store.ts`, `reader-identity.ts`, `policy.ts`, `functions/trust/[siteId].js` | 6 |
| Reputacion del lector (`reader_conduct`) con completitud, y emision desde el ledger | `scoring/reader-attestations.ts`, `reader-conduct-emitter.ts`, `reader-conduct-config.ts`, `functions/admin/api/reader-conduct/emit.js` | 6.4 |

## 4. Historial de brechas

| # | Brecha original | Estado | Como se cerro |
|---|---|---|---|
| B1 | El documento DID no es publico | Cerrada | `GET /.well-known/did.json` (5.1). |
| B2 | El TXT publicado no incluye identidad | Cerrada | Manifiesto v2 con `k`, `h` y `rg` (5.1). |
| B3 | La clave del sitio nunca firma nada | Cerrada | JWS del sitio, manifiesto extendido, entradas del historial y `self` (5.2, 5.3). |
| B4 | La verificacion de un agente no es re-verificable | Cerrada | Atestacion firmada con la clave del directorio Web Bot Auth del agente (5.3). |
| B5 | Los reportes de escrow no son verificables por terceros | Cerrada | Atestacion firmada con la clave publica registrada del proveedor (5.3). |
| B6 | El historial se puede editar sin rastro | Cerrada | Historial encadenado anclado con `h` en el DNS (5.4) y testigos (5.7). No detecta la omision inicial (5.7). |
| B7 | `community` no tiene identidad de votante | Abierta | Sigue fuera de la cadena (5.3); requiere identidad de votante (seccion 7). |
| B8 | El voto fallaba en self-host | Cerrada | Corregido al publicar la especificacion. |
| B9 | La reputacion es de lectura publica y unidireccional | Cerrada con limites | Politica de lectura (6.5) y reputacion del lector (6.4). *Equivocation* y reescritura: testigos (5.7). Omision en el origen: sin detector (5.7). |

## 5. Identidad e historial (v1.1 + E-1 a E-5, E-9)

### 5.1 Resolucion de `did:apw` (cierra B1 y B2)

`did:apw:<dominio>` se resuelve por **dos canales que deben coincidir**:

1. **DNS (raiz de confianza).** El manifiesto en `_apw.<dominio>` agrega el campo `k`: huella de la clave publica activa. Ocupa 43 caracteres y deja margen dentro de los ~512 bytes.
2. **HTTPS (documento completo).** `GET https://<dominio>/.well-known/did.json` devuelve el `didDocument` publico (sin clave privada), con el mismo formato que `did:web`.

**Calculo de `k` (normativo).** `k` es el **JWK Thumbprint de RFC 7638** con SHA-256, en base64url sin padding. Se calcula solo sobre los miembros obligatorios de la clave, en orden lexicografico y sin espacios. Para Ed25519 (`kty: "OKP"`, RFC 8037) son `crv`, `kty` y `x`:

```
{"crv":"Ed25519","kty":"OKP","x":"<x>"}
```

No se canonicaliza el JWK completo: los miembros opcionales (`key_ops`, `ext`, `alg`, `kid`) varian segun la implementacion y harian que dos verificadores calculen huellas distintas. Es el mismo calculo que usa Web Bot Auth para el `keyid`, asi que la huella APW de un agente coincide con su `keyid` (6.3). Vectores: V-01 en [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md).

**Regla de validez.** Un resolver considera valida la identidad solo si la huella de la clave del `did.json` es igual a `k` del TXT. Si no coinciden, la identidad es invalida: el canal HTTPS no puede suplantar al DNS. Rotar la clave implica actualizar el TXT; las claves anteriores siguen publicadas con su ventana de validez (5.4). Si el manifiesto no trae `k`, la identidad no es verificable (`manifest_without_key`).

**Manifiesto v2.** El resolver acepta v1 y v2: un manifiesto v1 sigue siendo valido, pero sin identidad verificable. Los campos `k` y `h` deben ser strings base64url de 43 caracteres y `rg` booleano; en v1 se ignoran. El campo `rg` se define en 6.5.

```json
{"v":2,"siteId":"ejemplo.com","trustUrl":"/trust/ejemplo.com","contentKinds":["mixed"],"k":"<huella>","h":"<cabeza>","rg":true}
```

El manifiesto se serializa como JSON compacto (sin espacios) y los campos opcionales se omiten en vez de serializarse como `null`.

### 5.2 Firma de artefactos del sitio (cierra B3)

Todo artefacto firmado por el sitio es un **JWS compacto** (RFC 7515) con `alg: "EdDSA"`, cuyo payload es JSON canonicalizado con JCS (RFC 8785). El primer artefacto es el **manifiesto extendido**, servido en `/.well-known/apw-manifest.jws`.

**Header (normativo).** `{ "alg": "EdDSA", "kid": "<keyId>", "typ": "<typ>" }`. El header tambien se serializa con JCS.

- `kid` es el `keyId` de la clave activa, `did:apw:<dominio>#key-<n>` (E-3). No es un `#key-1` fijo: despues de rotar, firmar con `#key-1` haria imposible encontrar la clave correcta.
- El `kid` debe pertenecer al DID del firmante: un sitio no firma con un `keyId` de otro dominio.
- `typ` es el tipo esperado del artefacto: `apw-manifest+jws` para el manifiesto extendido, `apw-attestation+jws` para las atestaciones `self` (5.3).

**Payload (normativo).** Serializado con **JCS (RFC 8785)** antes de firmar. Solo valores I-JSON: el emisor rechaza `undefined`, `NaN`, `Infinity`, `bigint`, funciones y objetos que no sean planos, en vez de omitirlos o convertirlos. JCS se implementa con un paquete listado en RFC 8785 como referencia (en Portaless: `canonicalize`).

**Verificacion de un artefacto del sitio (normativo).**

- `alg` = `EdDSA`, `typ` y `kid` exactamente los esperados.
- Firma valida con la clave publica de ese `kid` (del documento DID o de `keys` del log, 5.4).
- El payload recibido debe estar **en forma JCS**: si `JCS(JSON.parse(payload))` no reproduce los bytes firmados, se rechaza (`not_canonical`). Esto es mas estricto que la verificacion de atestaciones de emisor ajeno (5.3), donde el receptor no canonicaliza, porque aca el emisor es siempre una implementacion APW y JCS es obligatorio.

**Manifiesto extendido**: `GET /.well-known/apw-manifest.jws`.

- `typ`: `apw-manifest+jws`. Respuesta `application/jose`, publica (sin Web Bot Auth), cache corta.
- Payload: los mismos campos del TXT `_apw.<dominio>` (`v`, `siteId`, `trustUrl`, `contentKinds`, `k`, `h`, y `rg` cuando exista) mas `did` (el DID del sitio) e `iat` (segundos Unix). TXT y manifiesto salen de la misma funcion, asi que no pueden divergir.
- Un resolver acepta el manifiesto si: la firma verifica con la clave del `kid`; la huella RFC 7638 de esa clave es `k` del TXT; y `siteId`, `trustUrl`, `contentKinds` y `k` coinciden con el TXT.
- `h` del manifiesto puede ser **mas nuevo** que el del TXT: el manifiesto se firma con la cabeza actual del historial y el TXT se actualiza a mano. No se exige igualdad; el resolver verifica que el `h` del TXT aparezca en la cadena y que la cadena llegue hasta el `h` del manifiesto (las entradas intermedias quedan sin anclar, 5.4).
- Sin identidad responde `404 site_identity_not_found`, igual que `did.json`.

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

**Entrega.** El JWS compacto va en `body.attestation`, junto a los campos planos de siempre. Los campos planos tienen que coincidir con el payload firmado; si no coinciden, se responde `400 attestation_mismatch`. La firma manda: un cuerpo plano distinto nunca se acepta.

| Fuente | Endpoint | Clave que verifica | `iss` | Coincidencia exigida |
|---|---|---|---|---|
| `agent` | `POST /trust/:siteId/agent-verification` | La del directorio Web Bot Auth del agente; `kid` del header = `keyid` de la firma HTTP | Origen de `Signature-Agent` | `cat` = `category`, `val` = `verified` |
| `escrow_report` | `POST /trust/:siteId/escrow-report` | `public_key_jwk` registrada del proveedor | `escrowProvider` | `cat` = `transactionOutcome`, `val` = `true` |
| `self` | `PUT /admin/site-trust/:siteId/self` | La clave del `kid` (5.2) | `did:apw:<dominio>` del sitio | `cat` = categoria declarada, `val` = valor declarado |

**Validaciones** (en este orden):

1. Header: `alg` = `EdDSA`; si trae `typ`, debe ser `apw-attestation+jws`.
2. Clave Ed25519 (`kty: "OKP"`, `crv: "Ed25519"`). Las claves ML-DSA no se aceptan para atestaciones.
3. Firma valida sobre los bytes recibidos. El receptor no canonicaliza el payload.
4. Payload: `typ` = `apw-attestation+jws`; `sub` = `did:apw:<siteId>`; `src` = la fuente del endpoint; `iss` como en la tabla (las URLs https se comparan por origen); `cat` string de 1 a 64 caracteres; `val` booleano; `jti` de 1 a 128 caracteres ASCII visibles (`[\x21-\x7e]`).
5. `iat` dentro de +-300 segundos del reloj del receptor. *(No aplica al leer atestaciones del historial publicado de un tercero: ahi manda `skipIatWindow`, 5.5.)*
6. `jti` unico por emisor. Un `jti` repetido responde `409 duplicate_attestation`.

Si se exige `kid` (por ejemplo en `self`), debe coincidir exactamente con el esperado. Los fallos usan los codigos de [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md) V-06.

**Autenticacion previa sin cambios.** `agent` sigue exigiendo Web Bot Auth y la allowlist `authorized_agents`; `escrow_report` sigue exigiendo la API key. Un proveedor sin `public_key_jwk` queda autorizado pero no puede reportar (`403 provider_without_public_key`).

**Persistencia.** El JWS se guarda completo en la fila existente de SiteTrustScore (`attestation_jws`, `attestation_jti`), sin un store paralelo. Si `sub` es el DID del propio sitio, el JWS se anota ademas en el historial encadenado (5.4). Si el historial falla, el reporte igual queda guardado y la respuesta lo indica con `logged: false`. Las filas anteriores al esquema firmado quedan con `attestation_jws` vacio: no son verificables por terceros.

**Por fuente**:

- **`agent`**: `iss` es el origen `Signature-Agent` del agente y la firma usa **la misma clave Ed25519 que ya publica en su directorio Web Bot Auth**.
- **`escrow_report`**: `iss` es el `provider_id`; `authorized_escrow_providers` guarda la clave publica del proveedor. La API key sigue autenticando el endpoint; la firma es la prueba exportable.
- **`self`**: la firma el sitio con su propia clave (5.2), `iss` = `sub` = `did:apw:<dominio>`, `jti` aleatorio, header `typ` = `apw-attestation+jws` y `kid` = `keyId` activo. Se verifica con la misma rutina de validacion, usando la clave del `kid`. El JWS se guarda en la fila existente de `site_trust_self_evaluations` (`attestation_jws`, `attestation_jti`); la fila es upsert por categoria y guarda la atestacion **vigente**, mientras las anteriores quedan en el historial encadenado. Si el sitio no tiene identidad, la declaracion se guarda sin JWS y la respuesta informa `signed: false`: la firma es aditiva y no bloquea al admin que no completo el wizard, pero esas filas no son verificables por terceros. `self` sigue siendo la senal mas debil (peso fijo 0.25, A.4.2); la firma la hace atribuible, no mas confiable.
- **`community`**: queda **fuera de la cadena** (B7). Se sigue mostrando como dato local, marcado como no verificable.
- **`reader_conduct`**: ver 6.4.

### 5.4 Historial encadenado (cierra B6)

Cada atestacion aceptada se agrega a un log del sitio. Cada entrada es un JWS firmado por el sitio con payload `{ seq, prev, att, ts }`, donde `prev` es el hash de la entrada anterior, `att` el hash del JWS del emisor y `ts` el instante de anotacion.

**Definiciones normativas:**

- **Hash**: `base64url(SHA-256(jws))` sin padding, calculado sobre el JWS compacto tal cual (43 caracteres). Aplica a `prev`, `att` y `h`.
- **Primera entrada**: `seq: 1` y `prev: null`.
- **JWS de la entrada**: compacto, header `{ "alg": "EdDSA", "kid": "<kid>", "typ": "apw-log+jws" }`, donde `kid` es el `keyId` de la clave usada, `did:apw:<dominio>#key-<n>`. Entradas creadas antes de la definicion del `keyId` DID usan como `kid` la huella RFC 7638 de la clave; ambos formatos se aceptan al verificar.
- **`ts`**: ISO 8601 en UTC. No puede ser anterior al `ts` de la entrada previa (`ts_regression`).
- **Unicidad**: no se puede anotar dos veces la misma atestacion (`duplicate_attestation`).

**Verificacion de la cadena** (en este orden):

- Cada entrada se resuelve por el `kid` de su header, contra la lista de claves publicas del sitio (`unknown_key` si no esta).
- El `keyId` debe tener el formato `did:apw:<dominio>#key-<n>` con `<n>` entero positivo sin ceros a la izquierda, y el DID debe ser el del dominio verificado (`key_kid_mismatch`).
- La huella publicada de cada clave debe ser el thumbprint de su clave publica; dos claves no pueden compartir identificador ni un `keyId` puede coincidir con la huella de otra (`key_kid_mismatch`).
- Firma valida de cada entrada (`bad_signature`), `seq` consecutivo (`seq_gap`), `prev` igual al hash de la entrada anterior (`prev_mismatch`), `ts` dentro de la ventana de la clave que firmo y no anterior a la previa (`ts_outside_key_window`, `ts_regression`).
- `k` del TXT debe ser la clave activa (`validTo: null`) del log (`active_key_mismatch`). Asi el DNS ata la lista de claves.
- `h` del TXT debe ser el hash de alguna entrada de la cadena. Si no aparece, se borro o altero una entrada ya publicada (`head_mismatch`).

**Publicacion**: `GET /.well-known/apw-log.json`, paginado con `?from=<seq>&limit=<n>` (maximo 500). Devuelve `did`, `head` (`{ seq, hash }`), `length`, `keys` y `entries` (`{ seq, jws }`) y `next`. Cada elemento de `keys` trae `keyId`, `keySequence`, `fingerprint`, el alias `kid` (= `fingerprint`), `validFrom`, `validTo` y `publicKeyJwk` **solo con miembros publicos** (`crv`, `kty`, `x`). Sin identidad responde `404`.

**Rotacion de claves**: rotar no invalida el historial. Cada clave del sitio tiene dos identificadores y publica ambos:

| Campo | Valor | Uso |
|---|---|---|
| `keyId` | `did:apw:<dominio>#key-<n>` | `kid` del header de todo JWS que firma el sitio |
| `keySequence` | `<n>`, entero desde 1, unico por sitio | Crece con cada rotacion; no se reutiliza |
| `fingerprint` | huella RFC 7638 (5.1) | Se compara con `k` del TXT. Se publica tambien como `kid`, por compatibilidad |

El sitio conserva cada clave publica que uso con su ventana `validFrom` / `validTo` y la publica en `keys`. Una entrada se verifica contra la clave que indica su `kid`, siempre que su `ts` caiga dentro de la ventana de esa clave (extremos incluidos). La clave privada de una clave retirada se elimina al rotar. Las claves existentes reciben `#key-1`, `#key-2`... segun su fecha de alta; la columna `kid` del log guarda la huella de la clave que firmo.

**Anclaje en el DNS**: las entradas posteriores a `h` son validas pero todavia no estan ancladas: `h` cambia con cada atestacion y el TXT se actualiza a mano (el calculo del valor es automatico: panel de admin y `dnslink/cli.mjs --anchor --domain`, ambos con `buildSiteManifest`). Un verificador debe informar cuantas entradas quedan sin anclar. Los testigos (5.7) anclan la cabeza en el tiempo **sin tocar el DNS**: entre dos observaciones ancladas de un testigo, la cadena del sujeto no puede haber cambiado retroactivamente.

**Paquete de atestaciones (E-9)**: la entrada firmada del log sigue conteniendo solo el hash `att`; el JWS completo de cada atestacion se guarda aparte (`att_jws`) y se publica en `GET /.well-known/apw-attestations.json` (`{ did, entries: [{ seq, att, jws }], next }`).

**Limitaciones que siguen vigentes**:

- No detecta omisiones (5.7: los testigos acotan reescritura, *equivocation* y backdating, no la omision inicial).
- `ts` lo declara el propio sitio. Con una clave comprometida se podrian firmar entradas con fechas viejas dentro de la ventana de esa clave; el anclaje de `h` en el DNS y los testigos (5.7) acotan ese riesgo.

### 5.5 Exportacion y verificacion

- La cadena se publica en `GET /.well-known/apw-log.json` y los JWS de cada emisor en `GET /.well-known/apw-attestations.json`. *Esto reemplaza al `GET /trust/:siteId/attestations` previsto originalmente.*
- `resolveApwHistory(domain)` resuelve el TXT, verifica `k` contra la clave activa del log, recorre la cadena y comprueba el anclaje de `h`. Devuelve un resultado y nunca lanza, con `anchoredSeq` y `unanchoredEntries`.
- La verificacion de cada atestacion contra la clave de su emisor la hace quien consume el paquete. Para `reader_conduct`, esa carga esta en `loadReaderConduct()` (6.4): cada JWS debe tener su hash `att` en la cadena, y cada `att` de la cadena debe tener su JWS (completitud).

### 5.6 Vectores de prueba

La especificacion se publica con vectores fijos (claves, payloads, JWS, hashes, reglas de rechazo y puntajes del Anexo A) para que otra implementacion pueda comprobar compatibilidad sin depender del codigo de Portaless. Todos los vectores vigentes estan en [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md), en un archivo independiente del codigo.

### 5.7 Testigos (E-10)

Un **testigo** es cualquier sitio con identidad `did:apw` que observa la cadena encadenada de OTRO sitio y publica un statement firmado con la cabeza que vio. Cierra la brecha de *equivocation* y de reescritura retroactiva del historial (5.4) sin autoridad central: la fecha creible del statement no la declara el testigo en su payload, sino la entrada encadenada del PROPIO testigo, anclada por el `h` del testigo en el DNS.

**Statement** (JWS compacto; header `typ: "apw-witness+jws"`; payload en JCS, como todo artefacto firmado del sitio):

```json
{
  "typ": "apw-witness+jws",
  "iss": "did:apw:<testigo>",
  "sub": "did:apw:<sujeto>",
  "seq": 3,
  "head": "<hash de 43 caracteres o null>",
  "ts": "2026-10-09T12:00:00.000Z",
  "jti": "wt-<base64url(SHA-256(iss|sub|seq|head))>"
}
```

- `seq` y `head` describen la **ultima entrada** de la cadena del sujeto observada: `seq` es su longitud y `head` su hash. `seq: 0` con `head: null` significa cadena vacia observada. `seq > 0` exige `head`; `seq = 0` prohibe `head` (*fail-closed*: cualquier otra combinacion es statement invalido).
- `jti` es determinista: repetir la observacion del mismo head produce el mismo `jti` y no genera un statement nuevo.
- `ts` es el instante declarado de la observacion. **No es la fecha creible**: la fecha creible es el `ts` de la entrada del historial DEL TESTIGO donde el statement quedo anotado (5.4), porque esa entrada esta encadenada y su hash se ancla con el `h` del testigo.
- Firma: clave del testigo (5.2). El statement se anota en el historial del testigo como cualquier atestacion: queda encadenada, publicada en su `apw-attestations.json` (E-9) y protegida por su anclaje en el DNS.

**Publicacion**: `GET /.well-known/apw-witnesses.json`, paginado igual que `apw-attestations.json` (`?from`, `?limit`), con solo los statements `apw-witness+jws` del historial: `{ did, length, entries: [{ seq, att, jws, witness: { sub, seq, head, ts, jti } }], next }`.

**Registro (implementacion de referencia)**: `POST /admin/api/witness/record` con `{ domain }` (rol admin) resuelve la cadena del sujeto via `resolveApwHistory()` (5.5) y anota el statement en el historial propio. El `jti` determinista hace idempotente la repeticion del mismo head (`duplicate_attestation` en el indice unico de la cadena).

**Verificacion (normativa)** — evaluar un sujeto con testigos:

1. Verificar la cadena de cada TESTIGO (5.4), con `resolveApwHistory()`.
2. Cada statement debe estar **anotado en esa cadena verificada**: `att = base64url(SHA-256(jws))` debe coincidir con una entrada, y el JWS debe verificar contra la clave del testigo (5.2): `typ` correcto, firma valida, `jti` igual al recomputado, `iss` igual al DID del testigo y `sub` igual al DID del sujeto. Una observacion que no este en una cadena verificada **no cuenta**.
3. Cruzar cada observacion anclada `(witnessDid, seq, head, anchoredTs)`, donde `anchoredTs` es el `ts` de su entrada en la cadena del testigo, contra la cadena ACTUAL del sujeto. Hallazgos normativos:
   - **`head_mismatch`**: la entrada `seq` de la cadena actual tiene un hash distinto de `head` (o la cadena es mas corta que `seq`). El sujeto reescribio o trunco una cabeza ya observada.
   - **`equivocation`**: dos observaciones ancladas con el mismo `seq` y `head` distintos: dos testigos vieron cadenas incompatibles en la misma posicion.
   - **`backdated_entry`**: una entrada del sujeto con `seq` MAYOR que el `seq` observado declara un `ts` anterior a `anchoredTs` del testigo menos 300 s. Esa entrada no existia cuando el testigo observo: su `ts` es falso.
4. **Fail-closed**: ante cualquier hallazgo, la cadena del sujeto no es confiable para reputacion. Un hallazgo basta; no se promedia.

**Que NO cubre**: la omision desde el origen (el sitio nunca anoto una atestacion que no le conviene). Detectarla exige cruzar el historial del EMISOR de esa atestacion con el del lector — comparacion entre emisor y receptor, fuera del alcance de 5.7. Los testigos acotan reescritura, truncamiento, *equivocation* y backdating.

**Limites**:

- Un testigo malicioso puede inventar observaciones; por eso solo cuentan las ancladas en la cadena verificada DEL testigo, y quien evalua decide que testigos escuchar (no normativo aqui: Portaless Index sera el primer agregador).
- Dos observaciones del mismo sujeto separadas horas prueban que su cabeza no cambio entre esos momentos, aun sin actualizar el TXT.
- La actualizacion del TXT sigue siendo manual (ningun proveedor de DNS expone una API estandarizada); el **calculo** del valor es automatico (`dnslink/cli.mjs --anchor --domain <d>` y el checklist del panel, ambos con `buildSiteManifest`).

**Agregador (Portaless Index, informativo)**: quien evalua necesita escuchar varios testigos. Portaless implementa el primer agregador como funcion de un nodo: `POST /admin/api/index/sync` (rol admin) consulta a un set de testigos configurados (pull de `/.well-known/apw-witnesses.json`, paginado), aplica a cada statement exactamente los cuatro verificadores de 5.7 (cadena del testigo verificada, `att` anclado en esa cadena, firma contra su clave y `jti` determinista; ademas `iss`/`sub` esperados y sin self-witness), guarda la ultima observacion anclada por (sujeto, testigo, seq) — una ancla menor nunca pisa a la mayor — y evalua contra la cadena viva del sujeto. La **ponderacion** es estatica: un peso por testigo (default 1.0, editable por quien sincroniza); el `consensus` del directorio es la cabeza con mas suma de pesos en la ultima `seq` observada. El resultado se cachea y se publica como documento plano en `/.well-known/apw-index.json` (`{ typ: "apw-index", iss, generatedAt, subjects[] }`), sin firma propia porque cada entrada es re-verificable contra las cadenas del sujeto y de sus testigos. **Queda fuera de esta version**: la calibracion de pesos estilo A.4.4 (un testigo gana peso por acertar con el consenso), la sincronizacion push/gossip entre nodos indice (cada nodo solo hace pull de sus testigos) y la agregacion de manifiestos/SiteTrustScore de otras instancias (seccion 7).

## 6. Gobernanza de Lectura basada en Reputacion — Loyal Trust Protocol (v1.2 + E-8, E-9)

### 6.1 Problema (cierra B9)

La web es asimetrica: los rastreadores identifican, perfilan y califican a los sitios, pero los sitios no pueden identificar ni calificar a quien los lee. Con v1.1 el historial de reputacion de un sitio es publico: cualquiera puede armar una base de datos de "los mejores sitios" sin permiso ni contrapartida.

### 6.2 Concepto

El **Loyal Trust Protocol** (Reputacion de Confianza Mutua) usa la identidad APW en ambas direcciones:

1. El sitio define politicas de lectura sobre sus recursos de confianza y, mas adelante, de contenido.
2. Quien lee (agente de IA, indice, otro sitio) se autentica con Web Bot Auth y su origen `Signature-Agent` se resuelve a `did:apw:<dominio-del-lector>`.
3. El sitio verifica el historial APW del lector (5.5), calcula sus dimensiones (Anexo A) y evalua la politica. Solo si se cumple, entrega el recurso; si no, responde segun `on_fail`.

El resultado son **Trust Enclaves**: conjuntos de sitios y lectores que solo se exponen datos entre si cuando ambas partes prueban identidad y reputacion. Casos tipicos: indices que solo leen sitios que los aceptan, redes de medios independientes que comparten historial solo entre periodistas verificados, y sitios que no se dejan perfilar por rastreadores anonimos.

### 6.3 Identidad del lector

- El lector se identifica con Web Bot Auth (draft-03), implementado en `webbotauth/verify.ts`.
- Su origen `Signature-Agent` (por ejemplo `https://indice.example`) se mapea a `did:apw:indice.example`, que se resuelve igual que el de un sitio (5.1).
- La clave que firma la request Web Bot Auth debe tener la misma huella RFC 7638 que `k` en el TXT del lector, y su historial debe verificar. Asi la identidad del agente y la identidad APW quedan unificadas: un par de claves por dominio.
- **Claves no activas (normativo).** Despues de una rotacion (5.2), el lector tambien puede firmar con la clave retirada, pero solo dentro de su ventana efectiva `[validFrom, validTo + gracia]`, con `validTo` = instante de rotacion y gracia de rollover de 10 minutos **del lado de quien verifica**. La gracia no extiende nada publicado: la rotacion cierra la clave y borra su privada al rotar; existe para no cortar en seco los agentes que aun tenian la clave vieja en vuelo. Ademas de caer dentro de la ventana, la clave retirada debe cumplir todo lo siguiente (todo fail-closed):
  - figurar en `keys` del historial del lector, y ese historial ya haber verificado contra `k` y `h` del TXT;
  - haber firmado al menos una entrada de esa cadena: su huella o su `keyId` aparece como `kid` de una entrada anclada. Asi un compromiso **solo** del hosting del lector no alcanza para autorizarse una clave nueva, porque agregar una clave al arreglo `keys` no cambia ninguna entrada ni `h`;
  - no ser `k` (la activa sigue por su propio camino) y tener ventana parseable con `validTo` distinto de null.

  Si alguna condicion falla, o si el veredicto llega con la ventana ya cerrada, el lector queda `apw_unresolvable` con motivo `key_not_bound_to_apw`. La aceptacion se cachea como cualquier verificacion, pero el TTL se acota al cierre efectivo de la ventana: el cache nunca estira una clave retirada mas alla de `validTo + gracia`.
- La emision de `reader_conduct` (6.4) sigue exigiendo `operatorKeyId` = `k`: un lector en pleno rollover lee, pero no acumula reputacion hasta firmar con la clave activa.
- Estados del lector y respuestas: sin firma valida -> `401`; firma valida sin APW -> `on_fail`; APW que no se puede comprobar (o `reader_conduct` que no verifica, 6.4) -> `on_fail` con motivo `apw_unresolvable`; APW verificado -> se evaluan los umbrales.
- Un lector sin identidad APW puede autenticarse por Web Bot Auth, pero no tiene reputacion: cualquier politica que exija reputacion lo rechaza.

### 6.4 Reputacion del lector: atestaciones `reader_conduct`

Para que un lector tenga reputacion, alguien tiene que emitirla. La fuente **`reader_conduct`** emite un sitio sobre un lector despues de interactuar con el:

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
- `policy_violation` y `redistribution` con `val: true` son senales negativas reales, con la misma semantica que `agent.verified: false`. Un lector no puede borrarlas de su historial sin romper la cadena ni ocultarlas sin romper la completitud; si no las acepta, el emisor las conserva y puede exponerlas a otros sitios de su enclave.

**Carga y verificacion (normativo).** Quien evalua verifica la cadena del lector (5.4), baja el paquete de atestaciones y exige:

- que cada JWS tenga su hash `att` en la cadena (no se puede inventar ni alterar);
- completitud: que cada `att` de la cadena tenga su JWS (no se puede ocultar una `policy_violation` ya anotada);
- que cada `reader_conduct` con `sub` igual al DID del lector, y cuyo emisor no sea el propio lector, se verifique contra las claves publicadas del emisor: la clave activa debe ser `k` de su TXT, el header `kid` debe resolverse a esa clave, y el `iat` debe caer dentro de la ventana de la clave. La ventana de +-300 s sobre `iat` no aplica al leer del historial (`skipIatWindow`): el `ts` firmado de la cadena prueba cuando se anoto.
- Entradas con `ts` anterior a `legacyCutoff` (2026-10-04T00:00:00.000Z) pueden no tener JWS; segun `legacyEntriesWithoutJws` (`ignore` por defecto) se ignoran o rompen la completitud. Despues del corte, una entrada sin JWS siempre rompe la completitud.
- **Fail-closed**: si una `reader_conduct` no se puede verificar, el lector queda `apw_unresolvable` con motivo `reader_conduct_*`. Un lector no puede descartar sus negativas alegando que no verifican.

**Emision.** El ledger del Trust Layer es la fuente. El sitio registra en el ledger el DID candidato del lector (`did:apw:<host de Signature-Agent>`, sin verificar). `POST /admin/api/reader-conduct/emit` (admin + step-up) emite por periodo (mes por defecto) solo si `operatorKeyId` es `k` del TXT del lector. Firma con la clave activa, usa un `jti` determinista (emisor, lector, periodo, categoria) y anota cada emision en el historial propio: el emisor publica lo que emitio. Repetir la emision de un periodo no duplica: los `jti` ya anotados se informan como `already_emitted`. Hoy se emiten `respected_policy` y `policy_violation`; las otras tres esperan un dato que el origen todavia no tiene:

- `rate_respected` (R-02): no hay tasa que respetar. La politica de contenido solo declara `access`, `price_usd` y `unit`: no existe un limite de peticiones por lector, ni su enforcement, ni un contador de rechazos por tasa en el ledger.
- `paid_as_agreed` (R-03): el origen no sabe si el crawler pago. Con el proveedor de settlement actual (Cloudflare Pay Per Crawl, pricing in-band) el origen responde `200` con `crawler-price` y la cobranza se liquida fuera de el: por eso el ledger registra siempre `charged: false` y sus columnas de cobro no se mueven. Emitir esta categoria de ahi seria inventar el dato; haria falta un settlement que informe al origen el resultado.
- `redistribution` (R-04): no es observable por el origen (seccion 8): el protocolo puede registrar la conducta si alguien la detecta, no puede impedirla ni verla. Requiere testigos o denuncia de un tercero, no el ledger de accesos.

**Emision automatica (E-10)**: el Trust Layer puede disparar la misma emision al registrar un acceso verificado con `readerDid` candidato, sin paso manual. Los requisitos normativos son los mismos: solo se emite lo que el ledger dice del agente en ese periodo, con el mismo `jti` determinista y la misma comprobacion de `k` del lector; la repeticion sigue siendo `already_emitted`. Un opt-out explicito (`APW_AUTO_EMIT_CONDUCT=false`) la desactiva; el endpoint admin con step-up queda disponible para backfill de periodos viejos.

**Que prueba y que no prueba la completitud**: prueba que el lector no oculto ni altero atestaciones **que ya anoto** en una cadena anclada. No prueba que haya anotado todas las que recibio, ni que muestre la misma cadena a todos los visitantes.

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

**Almacenamiento (normativo).** La politica vive en su propia tabla tipada, `site_trust_read_policies`: `enabled`, `require_apw_identity` (fijo en 1), `min_r01`, `min_r01_weight`, `min_r05`, `min_r05_weight`, `public_overrides`, `on_fail` (`401`, `402` o `403`). Los valores por defecto son los de A.6. Sin fila, o con `enabled = 0`, la lectura es publica. `public_overrides` guarda el override explicito del dueno de A.6: un array de **dimensiones gobernadas** (nunca una publica, que ya lo es, ni una desconocida) que se vuelven publicas en la proyeccion; no cambia la politica ni el acceso, y un valor corrupto en la fila se ignora (el dueno queda sin override). El Centro de Permisos se reserva para **excepciones por lector**: un grant `trust:read-governance-bypass` (subject `reader`, cuyo `id` es el `did:apw:` del lector) le permite leer aunque no cumpla los umbrales. El bypass **no salta la identidad**: exige un lector `apw_verified` (6.3), no salta `require_apw_identity` ni valida una politica corrupta (sigue siendo `403 policy_invalid`); un lector cuya identidad no se pudo comprobar queda en `on_fail` grant o no. El manifiesto solo anuncia `rg: true`; la politica completa nunca se publica: publicarla le diria a un atacante exactamente que fabricar.

**Recursos gobernables**: `GET /trust/:siteId` (y sus equivalentes `/trust/*`). En una version posterior, cualquier ruta de contenido, combinandose con la politica `allow`/`charge`/`block` del Trust Layer.

- `on_fail: "402"` se integra con el settlement de pay-per-crawl: el dueno puede permitir compensar la confianza faltante con pago.
- Un predicado con dimension desconocida o valor invalido invalida la politica entera y la respuesta es `403 policy_invalid`.
- R-05 arranca desactivado en la configuracion (`policyDimensions`) y no es un simple interruptor: R-05 del sujeto es la calibracion de las atestaciones que **el** emitio (A.4.4), y `loadReaderConduct` solo carga las que el lector **recibio** (descarta `iss` igual a su DID). Un lector que no emite queda con R-05 = 4.0 y peso 0, asi que con `min_r05_weight = 2.0` la politica rechazaria a **todos** los lectores, no a los malos: la politica por defecto efectiva exige solo R-01. La tabla ya soporta `min_r05`, activarlo no requiere migracion, pero solo tiene sentido con los dos datos que faltan (seccion 7). El bloqueo esta anclado en `tests/unit/apw-reader-conduct-config.test.ts`.

### 6.6 Que sigue siendo publico

- El TXT (`k`, `h`, `rg`), `did.json`, el manifiesto extendido, el log y el paquete de atestaciones siempre son publicos: sin ellos nadie podria verificar nada.
- `h` es un compromiso publico sobre el historial: revela que existe y que cambio, no su contenido. Un lector autorizado comprueba que lo recibido coincide con `h`.
- Las dimensiones de nivel publico (A.6) y, de **todas** las dimensiones, el puntaje, la cantidad y la suma de pesos (agregados).

**Proyeccion en la respuesta (normativo).** `GET /trust/:siteId` calcula las dimensiones W del sitio a partir de su snapshot (A.2 y A.4) y las publica siempre en un objeto `projection` con `{ dimensions, aggregates, governed }`:

- Con politica activa y lector **rechazado**, `projection` va dentro de `public`: `dimensions` contiene **solo** el conjunto publico (W-01, W-04, W-06, W-07, W-09) mas las dimensiones gobernadas que el dueno volvio publicas con su override explicito (A.6, guardado en `public_overrides`), `aggregates` trae puntaje, cantidad y suma de pesos de **todas** las dimensiones del sitio y `governed` es `"withheld"`. El nivel publico nunca se oculta: una politica mas dura no saca W-01 de la respuesta.
- Con lector **autorizado** (grant o umbrales cumplidos), o con la lectura publica (sin politica), `projection` va en el cuerpo con **todas** las dimensiones y `governed` es `"granted"`.
- Una dimension sin atestaciones no aparece en ninguno de los dos objetos: sin datos no es `4.0`, es *sin datos*. `aggregates` tampoco inventa filas para W-08.
- Las categorias que A.2 no mapea (`community.perceived_trustworthiness`) no puntuan; sus filas siguen siendo publicas como dato crudo en el snapshot. La proyeccion es metadata: si su calculo fallara, la respuesta se emite sin ella y la decision de acceso no cambia.

### 6.7 Arranque en frio e identidades falsas

- **Arranque en frio**: un lector nuevo empieza con todas sus dimensiones en 4.0 y peso de evaluador 0.25 (A.4.2). Gana reputacion leyendo recursos de sitios con politicas laxas o publicas. Por eso el valor por defecto de un sitio es publicar el nivel publico completo.
- **Identidades falsas (Sybil)**: un atacante puede registrar muchos dominios y emitirse atestaciones entre ellos. Defensas exigidas:
  - **Ponderacion por quien evalua** (A.4.2): un dominio nuevo pesa 0.25 y solo gana peso si sus evaluaciones coinciden con el consenso de emisores ya ponderados.
  - Contar solo emisores **distintos** y exigir suma de pesos minima en cada predicado (`min_weight`). Las atestaciones de un lector sobre si mismo no cuentan para su R-05.
  - Antiguedad minima del historial del emisor (dimension W-07).
  - Ponderar `escrow_report` (terceros regulados) por encima de `reader_conduct` cuando la politica lo requiera.
- Ninguna defensa es perfecta: un atacante con suficientes dominios antiguos y bien calibrados puede construir reputacion. El costo de hacerlo es la defensa, como en cualquier red de confianza.

### 6.8 Implementacion sobre lo existente

| Pieza | Reutiliza | Agrega |
|---|---|---|
| Autenticacion del lector | `webbotauth/verify.ts` (draft-03) | Mapeo `Signature-Agent` -> `did:apw` y comprobacion de la clave contra `k` (`reader-identity.ts`) |
| Reputacion del lector | `resolveApwHistory()` (5.5), con cache por TTL | `reader_conduct` con completitud (`reader-attestations.ts`), emision desde el ledger (`reader-conduct-emitter.ts`) y calculo de dimensiones R |
| Politicas | Tabla tipada `site_trust_read_policies` | Evaluador de predicados (`policy.ts`) y proyeccion A.6 de las dimensiones W (`site-dimensions.ts`) |
| Excepciones por lector | `PermissionStore` del Centro de Permisos (`packages/permissions`) | Capacidad `trust:read-governance-bypass` sobre el DID del lector (subject `reader`) |
| Enforcement | `functions/_middleware.js` y `functions/trust/[siteId].js` | Respuestas 401, 403 o 402 con la proyeccion publica; nunca abre por defecto |
| 402 | `billing/pay-per-crawl/` | `on_fail: "402"` |

### 6.9 Limites

- La gobernanza protege lo que el sitio sirve gobernado. El contenido abierto (HTML publico, `llms.txt`) sigue siendo legible salvo que tambien se gobierne.
- Un lector autorizado puede copiar y redistribuir lo que lee. El protocolo puede registrar esa conducta (`redistribution`) si se detecta; no puede impedirla.
- Verificar reputacion en cada request agrega latencia: se cachea por host y huella (5 minutos si verifica, 60 segundos si falla), y en el caso de una clave retirada el TTL del exito se acota al cierre de su ventana (6.3). Si la politica o el historial del lector no se pueden resolver se aplica `on_fail` o `503`; nunca se abre por defecto.
- La completitud prueba que el lector no oculto atestaciones **ya anotadas**. No prueba que haya anotado todas las que recibio; los testigos (5.7) acotan que no muestre cadenas distintas a distintos observadores, pero no la omision inicial.

## 7. Futuro (fuera de la implementacion actual)

- **Portaless Index**: red de testigos y descubrimiento. El **agregador local** ya existe (5.7, "Agregador"): directorio de observaciones verificadas por sujeto, ponderacion estatica por testigo y publicacion en `/.well-known/apw-index.json`. Falta la red: la calibracion de pesos estilo A.4.4 (un testigo gana peso por acertar con el consenso), la sincronizacion gossip entre nodos indice (hoy cada nodo solo hace pull de sus testigos) y el descubrimiento de manifiestos/SiteTrustScore de multiples instancias (formato de indexabilidad, permiso de consulta de terceros y capa de procedencia). Index es tambien el primer lector natural de los enclaves.
- **`community` portable** (B7): requiere identidad de votante con resistencia a identidades falsas.
- **R-05 en politicas**: no es un interruptor de config, faltan dos datos (6.5). (1) Un flujo en que el lector **emita** atestaciones sobre sujetos: hoy solo existe el voto community anonimo por IP, sin DID, y `loadReaderConduct` ni siquiera carga lo que el lector emite (descarta `iss` igual a su DID). (2) Un **corpus** de otros emisores sobre el mismo (sujeto, dimension) para el consenso leave-one-out de A.4.4: indices o testigos. Mientras ambas falten, R-05 de un lector es 4.0 con peso 0 y el umbral la rechazaria a todos.
- **Senal de antiguedad del historial en W-07**: A.4.1 no define como llevar una antiguedad a la escala 1..7, asi que W-07 puntua hoy solo con `agent.content_freshness` (6.6).
- **Senales intra-dimension de A.2** (60/40, 50/50...): A.4.3 puntua con el peso del emisor (A.4.2); el peso de la senal dentro de la dimension sigue sin estar en la formula.
- **Nuevas senales de conducta** (6.4): cada una espera su propio dato. `rate_respected` exige una tasa en la politica de contenido y el contador de rechazos en el ledger; `paid_as_agreed` exige un settlement que le informe al origen si el crawler pago (el actual liquida fuera y el origen solo ve `charged: false`); `redistribution` exige testigos o denuncia, porque el origen no la observa (seccion 8).
- **Gobernanza de contenido**: extender 6.5 a cualquier ruta, no solo `/trust/*`.
- **ML-DSA (FIPS 204)** en las firmas APW del sitio y de los emisores. La verificacion ML-DSA ya existe para la identidad Web Bot Auth de la fuente `agent`, pero las atestaciones exigen Ed25519 (5.3).
- **Portaless Cloud Images**: el mismo formato de atestacion aplicado a imagenes.

## 8. Limites generales

- La identidad prueba control del DNS, no veracidad del contenido.
- Un sitio puede omitir atestaciones que no le convienen hasta que existan testigos.
- Si se compromete la clave del sitio, el atacante puede firmar entradas nuevas hasta que se rote y se actualice el TXT.
- `ts` lo declara quien firma la entrada: con una clave comprometida se pueden fechar entradas dentro de la ventana de esa clave.
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

Categorias sin dimension: `community.perceived_trustworthiness` no alimenta ninguna dimension (no figura en la tabla); sus votos siguen siendo publicos como fila cruda del snapshot. W-08 espera las categorias nuevas de `self` (origen declarado humano/IA) y todavia no tiene categorias.

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

Cada atestacion aporta un valor `v` en 1.0 a 7.0 a una dimension. Mapeo normativo:

| Entrada | Escala | Valor |
|---|---|---|
| `true` | booleana | 7.0 |
| `false` | booleana | 1.0 |
| 1 | `community` | 1.0 |
| 2 | `community` | 2.5 |
| 3 | `community` | 4.0 |
| 4 | `community` | 5.5 |
| 5 | `community` | 7.0 |
| `completed_as_promised` | `escrow_report` | 7.0 |
| `refunded_no_delivery` | `escrow_report` | 2.5 |
| `disputed` | `escrow_report` | 1.0 |

Los votos `community` (1 a 5) se reescalan linealmente a 1.0 a 7.0; un voto fuera de 1..5 es error. Los resultados de `escrow_report` van por la escala nativa (completada 7.0, reembolsada sin entrega 2.5, en disputa 1.0): en ese JWS `val` es siempre `true` y lo que puntua es el `cat` (5.3). Para `reader_conduct`: `respected_policy`/`rate_respected`/`paid_as_agreed` con `val: true` aportan 7.0 a su dimension R; `policy_violation` con `val: true` aporta 1.0 a R-01; `redistribution` con `val: true` aporta 1.0 a R-04.

#### A.4.2 Peso del emisor

```
w = ((clamp(J, 1, 7) - 1) / 6) ^ 2
```

`J` es la dimension R-05 del emisor. Un emisor nuevo tiene J = 4.0 y w = 0.25. Un emisor con J = 6.7 tiene w = 0.9025: su opinion pesa 3.61 veces mas. Un emisor con J = 1.0 tiene w = 0. La atestacion `self` tiene peso fijo 0.25 y nunca alimenta el R-05 propio.

#### A.4.3 Puntaje de una dimension

Promedio bayesiano ponderado, con previo neutral:

```
S = (P * 4.0 + suma(w_i * v_i)) / (P + suma(w_i))
```

con `P = 3`. Con pocas atestaciones el puntaje queda cerca de 4.0: una sola resena no lleva a nadie a un extremo.

#### A.4.4 Calibracion de R-05

`J = max(1, 7 - 1.5 x d)`, donde `d` es la desviacion absoluta media de las atestaciones del emisor en la escala 1 a 7. Un emisor sin atestaciones comparables queda en J = 4.0.

- La desviacion de cada atestacion se mide contra el **promedio ponderado de los demas emisores** sobre el mismo sujeto y dimension, **sin el previo P** (leave-one-out). P se sigue usando para el puntaje publicado (A.4.3), no para calibrar.
- J se calcula por punto fijo: se parte de J = 4.0 para todos y se itera (8 rondas en esta version), porque el peso de cada emisor depende del J de los demas.
- No cuentan para el R-05 propio: las atestaciones `self` ni las de un emisor sobre si mismo. Si los demas emisores no tienen peso, la atestacion no se compara.
- Un emisor que ataca sistematicamente pierde peso y sus ataques siguientes valen menos.

El factor 1.5, el numero de rondas y P son valores por defecto de esta version, ajustables con nuevos vectores de prueba (V-09 y V-10 en [`APW-VECTORS-v1.3.md`](./APW-VECTORS-v1.3.md)).

#### A.4.5 Ejemplo (calculado con las formulas anteriores)

- El sitio A tiene **6.0950** en W-10, con 10 atestaciones de 7.0 de emisores con J = 6.0 (w = 25/36 = 0.6944). Un emisor con J = 4.0 lo ataca con un 1.0: A baja a **5.9700** (-2.05%).
- El sitio B tiene 4.0000 en W-10, con 10 atestaciones de emisores con J = 5.0 (w = 4/9 = 0.4444). Un emisor con J = 6.7 dice que merece un 3.0: B baja a **3.8919**. Con un 1.0, baja a **3.6756** (-8.11%).
- Por cada punto de desviacion, la opinion del emisor de 6.7 mueve el puntaje 3.61 veces mas que la del emisor de 4.0.
- Sin atestaciones, el puntaje es el neutral **4.0000**.

#### A.4.6 Confianza

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

Politica por defecto para el nivel gobernado: identidad APW verificada, R-01 >= 5.0 y R-05 >= 5.0, cada una con suma de pesos >= 2.0, `on_fail: 403`. El dueno puede endurecerla o volver publico cualquier dato gobernado (override explicito), pero no puede ocultar el nivel publico: un sitio que esconde su seguridad tecnica no gana privacidad, pierde verificabilidad. Mientras R-05 este desactivado en la configuracion (6.5), la politica por defecto efectiva exige solo R-01 con los mismos umbrales.

---

## Referencias normativas

| Norma | Uso en APW |
|---|---|
| RFC 7515 | JWS compacto |
| RFC 7638 | JWK Thumbprint (`k`, `fingerprint`) |
| RFC 8037 | Claves OKP Ed25519 |
| RFC 8785 | JCS: canonicalizacion de payloads del sitio |
| RFC 9421 | Firma de requests HTTP (Web Bot Auth) |
| did:web | Formato del `didDocument` publico |
| draft-03 Web Bot Auth | Identidad del lector y de la fuente `agent` |
| FIPS 204 (ML-DSA) | Futuro post-cuadratico (columna `key_algorithm`) |
