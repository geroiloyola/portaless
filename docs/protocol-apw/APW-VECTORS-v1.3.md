# Protocol APW — Vectores de Prueba v1.3

**Companion normativo de [`APW-SPEC-v1.3.md`](./APW-SPEC-v1.3.md).** Este archivo es **independiente del codigo**: no importa, ejecuta ni referencia implementaciones. Cualquier implementacion ajena a Portaless puede comprobar compatibilidad usando solo este documento; Portaless lo cumple, pero no es la fuente de los vectores. **Licencia**: CC BY 4.0 (ver [Licencia y gobernanza](./APW-SPEC-v1.3.md#licencia-y-gobernanza)).

**Convenciones**

- Los valores numericos se dan con la precision suficiente para comparar con tolerancia de redondeo; donde la formula da un decimal exacto, se da exacto.
- Los vectores "estructurales" (headers, payloads, reglas de rechazo) no dependen de claves aleatorias: se prueban con cualquier par Ed25519 generado por el implementador. Los dos unicos pares fijos son los de V-01, tomados de las RFC.
- Todo lo que aqui aparece como *debe* y *debe solo* es normativo segun v1.3.

| ID | Bloque | Seccion de la spec |
|---|---|---|
| V-01 | Huella `k` (JWK Thumbprint RFC 7638) | 5.1 |
| V-02 | `keyId` / `keySequence` / `fingerprint` | 5.4 |
| V-03 | Manifiesto TXT v1 y v2 | 5.1 |
| V-04 | JCS (RFC 8785) | 5.2 |
| V-05 | Hash del historial y estructura de cadena | 5.4 |
| V-06 | Verificacion de atestaciones de emisor ajeno | 5.3 |
| V-07 | JWS del sitio (manifiesto extendido y `self`) | 5.2, 5.3 |
| V-08 | Primitivas de puntuacion | A.4.1 a A.4.4 |
| V-09 | Puntaje bayesiano (ejemplos A y B) | A.4.5 |
| V-10 | Calibracion de R-05 (leave-one-out) | A.4.4 |
| V-11 | Politica de lectura y niveles de visibilidad | 6.5, A.6 |
| V-12 | `reader_conduct`: emision y completitud | 6.4 |
| V-13 | Testigos: statement, `jti` y evaluacion (E-10) | 5.7 |

---

## V-01 — Huella `k` (RFC 7638)

Input: solo los miembros obligatorios del JWK Ed25519, en orden lexicografico, sin espacios:

```
{"crv":"Ed25519","kty":"OKP","x":"<x>"}
```

Output: `base64url(SHA-256(<json>))` sin padding, 43 caracteres.

| # | Clave | `x` | Huella esperada |
|---|---|---|---|
| 1 | RFC 8037, Apendice A | `11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo` | `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k` |
| 2 | RFC 9421, Apendice B.1.4 | `JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs` | `poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U` |

Reglas de rechazo:

- JWK sin `kty` soportado (distinto de `OKP`) -> error `unsupported_key_type`.
- JWK `OKP`/`Ed25519` sin `x` -> error `missing_jwk_member:x`.
- Miembros opcionales y privados (`d`, `key_ops`, `ext`, `kid`, `alg`) se **ignoran** al calcular: el vector 1 debe seguir dando la misma huella aunque se le agreguen.

## V-02 — Identificadores de clave

Con `did = did:apw:ejemplo.com`:

| Expresion | Valor esperado |
|---|---|
| `keyId(did, 1)` | `did:apw:ejemplo.com#key-1` |
| `keyId(did, 12)` | `did:apw:ejemplo.com#key-12` |
| `parse(keyId(did, 12))` | `{ did, sequence: 12 }` |
| `keySequence` en la primera clave de un sitio | `1` |
| Tras dos rotaciones | secuencias `1, 2, 3`; solo la ultima con `validTo: null` |
| `fingerprint` publicado en `keys[].kid` | igual a `fingerprint` (alias) |

Rechazos al construir: `did` que no sea `did:apw:<dominio>` (`invalid_did`); secuencia 0, negativa o no entera (`invalid_key_sequence`).

Rechazos al parsear (devuelve nulo): `#key-0`, `#key-01` (ceros a la izquierda), `#key-` sin numero, un DID sin fragmento, un `did:web:` con el mismo patron, una huella base64url de 43 caracteres sin `#key-<n>`, y cualquier no-string.

Invariantes de lista de claves (de lo contrario `key_kid_mismatch`):

- `kid` de cada clave = huella RFC 7638 de su `publicKeyJwk`.
- Ningun `keyId` repetido; ningun `keyId` igual a la huella de otra clave.
- Todo `keyId` con `did` igual al DID del sitio y `<n>` unico.

## V-03 — Manifiesto del TXT

Serializacion: JSON compacto (sin espacios), campos opcionales omitidos.

| # | Entrada | Resultado |
|---|---|---|
| 1 | `{siteId:"s", contentKinds:["mixed"]}` sin `k`/`h`/`rg` | v1: `{"v":1,"siteId":"s","trustUrl":"/trust/s","contentKinds":["mixed"]}` |
| 2 | lo mismo con `k` | v2: mismo payload con `"v":2` y el campo `k` |
| 3 | `v:2, k:"corta"` | rechazo `invalid_key_fingerprint` |
| 4 | `v:2, h:5` (no string) | rechazo `invalid_history_head` |
| 5 | `v:2, rg:"si"` (no booleano) | rechazo `invalid_read_governance` |
| 6 | `v:1` con `k` presente | valido como v1; `k` se **ignora** (no es identidad verificable) |
| 7 | `contentKinds: []` | rechazo `empty_contentKinds` |
| 8 | `contentKinds: ["pdf"]` | rechazo `invalid_contentKind_value` (vocabulario cerrado: `text`, `image`, `product`, `link`, `mixed`) |
| 9 | `trustUrl` sin prefijo `/trust/` | rechazo `missing_or_invalid_trustUrl` |
| 10 | JSON roto o escalar | rechazo `not_an_object` |
| 11 | `v:3` | rechazo `missing_or_invalid_version` |

Formatos aceptados de `k` y `h`: `/^[A-Za-z0-9_-]{43}$/`. Ejemplo de manifiesto v2 completo:

```
{"v":2,"siteId":"ejemplo.com","trustUrl":"/trust/ejemplo.com","contentKinds":["mixed"],"k":"kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k","h":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","rg":true}
```

Resolucion cruzada `TXT` + `did.json` (razones esperadas):

| Situacion | Razon |
|---|---|
| huella del `did.json` == `k` y `id` == `did:apw:<dominio>` | `ok`, `verified: true` |
| huella distinta de `k` | `key_mismatch` |
| `did.json` de otro dominio | `did_mismatch` |
| manifiesto sin `k` (una sola consulta DNS; no se consulta `did.json`) | `manifest_without_key` |
| `did.json` no alcanzable | `did_document_unreachable` |
| `did.json` sin estructura DID valida | `invalid_did_document` |
| sitio sin identidad registrada | `404 site_identity_not_found` |

El `did.json` publico **nunca** incluye miembros privados ni `d`; solo la clave publica en `verificationMethod[0].publicKeyJwk` con exactamente `crv`, `kty`, `x`.

## V-04 — JCS (RFC 8785)

| # | Input | Output |
|---|---|---|
| 1 | `{ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } }` | `{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}` |
| 2 | `{ n: -0 }` | `{"n":0}` |
| 3 | `[1e21, 1.5, 100]` | `[1e+21,1.5,100]` |
| 4 | `{ s: "ñ€" }` | `{"s":"ñ€"}` (unicode sin escapar) |

Rechazos del emisor (error `not_i_json`): `undefined`, `NaN`, `Infinity`, funciones, `bigint`, `Date`. El emisor rechaza en vez de omitir o convertir.

## V-05 — Hash de historial y cadena

Hash normativo: `base64url(SHA-256(<bytes>))` sin padding (43 chars).

| # | Input (utf-8) | Hash esperado |
|---|---|---|
| 1 | cadena vacia | `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU` |
| 2 | `att-1` | `IIZMRjHGtF_r1Jv8RZNnxpJ2s-xVBZoz-BkR8IWH9Ik` |
| 3 | 43 caracteres `A` | `DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo` |

Estructura de la entrada de log:

- Header JWS: `{"alg":"EdDSA","kid":"did:apw:<dominio>#key-<n>","typ":"apw-log+jws"}` (o `kid` = huella en entradas anteriores a la definicion del `keyId`; ambos se aceptan).
- Payload: `{"seq":1,"prev":null,"att":"<hash 43>","ts":"<ISO 8601 UTC>"}`.
- `seq` crece de 1 en 1; `prev` de la entrada `n` = `hash(jws de la n-1)`; `h` del TXT = `hash` de alguna entrada.

Paginacion de `GET /.well-known/apw-log.json`: `?from=<seq>&limit=<n>`, `limit` maximo 500; respuesta `{ did, head: { seq, hash }, length, keys, entries: [{ seq, jws }], next }`, donde `next` es la siguiente `seq` o `null`. Sin identidad: `404`. `keys[i]` solo expone miembros publicos del JWK (`crv`, `kty`, `x`).

Matriz de rechazo de la cadena:

| Mutacion | Motivo esperado |
|---|---|
| payload de una entrada reemplazado por otro | `bad_signature` en ese `seq` |
| una entrada eliminada | `seq_gap` |
| `prev` que no es el hash de la anterior | `prev_mismatch` |
| `ts` anterior a la de la entrada previa | `ts_regression` |
| `ts` fuera de la ventana `validFrom`/`validTo` de su clave | `ts_outside_key_window` |
| `kid` de una entrada no publicado en `keys` | `unknown_key` |
| `kid` de otro dominio o mal formado | `key_kid_mismatch` |
| `k` del TXT != clave activa del log | `active_key_mismatch` |
| `h` del TXT que no aparece en la cadena | `head_mismatch` |
| cadena vacia con `h` publicado | `head_mismatch` |
| cadena vacia sin `h` | valida (`length: 0`, `head: null`) |

Anclaje: si `h` del TXT corresponde a la entrada `s`, la cadena verifica con `anchoredSeq = s` y `unanchoredEntries = length - s`; `h` igual a la ultima entrada da `unanchoredEntries = 0`. Rotar la clave no invalida el pasado: la cadena verifica con la clave activa nueva, y falla con `active_key_mismatch` si se exige la retirada.

## V-06 — Atestaciones de emisor ajeno

Payload tipico (`agent` sobre un sitio, con `iss` = origen https del agente):

```json
{"typ":"apw-attestation+jws","iss":"https://agente.example","sub":"did:apw:ejemplo.com","src":"agent","cat":"https_and_headers","val":true,"iat":1790000000,"jti":"agt-2026-10-abc"}
```

El receptor verifica los bytes **tal cual llegan** (no canonicaliza). Orden de validacion y su primer fallo:

| Paso | Condicion | Fallo |
|---|---|---|
| 1 | JWS compacto de 3 partes, <= 8192 chars | `malformed_attestation` |
| 2 | header/payload decodifican a objetos | `malformed_attestation` |
| 3 | `header.alg == "EdDSA"` | `unsupported_alg` |
| 4 | `header.typ` ausente o `apw-attestation+jws`; `payload.typ == "apw-attestation+jws"` | `invalid_typ` |
| 5 | `header.kid` == el esperado, cuando se exige | `kid_mismatch` |
| 6 | clave `kty: OKP`, `crv: Ed25519`, `x` string (no ML-DSA) | `unsupported_key` |
| 7 | firma Ed25519 valida sobre `header.payload` | `bad_signature` |
| 8 | claims: `iss`/`sub`/`src`/`cat`/`jti` strings, `cat` de 1..64, `val` booleano, `iat` entero seguro, `jti` en `[\x21-\x7e]{1,128}` | `invalid_claims` |
| 9 | `sub == did:apw:<siteId>` | `sub_mismatch` |
| 10 | `src` == la fuente del endpoint | `src_mismatch` |
| 11 | `iss` igual al esperado (URLs https por **origen**) | `iss_mismatch` |
| 12 | `abs(now - iat) <= 300` s, salvo `skipIatWindow` | `iat_out_of_window` |

Casos de `iss` por https: `https://agente.example/p` y `https://agente.example/otra` son el mismo emisor; `http://agente.example` o `https://sub.agente.example` no lo son.

`jti` unico por emisor: repetir un `jti` aceptado -> `409 duplicate_attestation`. Campos planos del cuerpo distintos del payload firmado -> `400 attestation_mismatch`. Proveedor escrow sin `public_key_jwk` -> `403 provider_without_public_key`. Si el anclaje en el historial falla pero el reporte se guarda -> respuesta con `logged: false`.

`reader_conduct` leido del historial de un tercero: mismo orden, pero `skipIatWindow` activo y la clave debe ser la activa (`k` del TXT del emisor); cualquier fallo deja al lector en `apw_unresolvable`.

## V-07 — JWS firmados por el sitio

Header exacto: `{"alg":"EdDSA","kid":"did:apw:<dominio>#key-<n>","typ":"<typ>"}`. Payload en forma JCS estricta.

Manifiesto extendido (`typ: apw-manifest+jws`, `GET /.well-known/apw-manifest.jws`, `application/jose`): payload = campos del TXT + `did` + `iat`:

```json
{"did":"did:apw:default","h":"aaaa…(43)","iat":1790000000,"k":"aaaa…(43)","rg":true,"siteId":"default","trustUrl":"/trust/default","contentKinds":["text"],"v":2}
```

Ese objeto, canonicalizado, debe reproducir exactamente los bytes del payload. `self` usa `typ: apw-attestation+jws`, `iss = sub = did:apw:<dominio>`, y se verifica con la rutina de V-06 exigiendo `kid`.

Mutaciones y resultados:

| Mutacion | Resultado |
|---|---|
| byte alterado en la firma | `bad_signature` |
| `kid` = `#key-2` cuando se exige `#key-1` | `kid_mismatch` |
| `typ` distinto del esperado | `invalid_typ` |
| firma hecha con la clave de otra rotacion | `bad_signature` |
| payload no JCS (bytes que no son `JCS(JSON.parse(payload))`) | `not_canonical` |
| `kid` que no es `did:apw:<dominio>#key-<n>` al firmar | error `invalid_key_id` |
| `kid` de otro DID al firmar `self` | error `key_id_not_for_did` |
| sin identidad registrada | `404 site_identity_not_found` |

## V-08 — Primitivas de puntuacion

Peso del emisor, `w(J) = ((clamp(J,1,7) - 1) / 6)^2`:

| J | w |
|---|---|
| 1.0 | 0.0 (exacto) |
| 4.0 | 0.25 (exacto) |
| 5.0 | 0.444444… (= 4/9) |
| 6.0 | 0.694444… (= 25/36) |
| 6.7 | 0.9025 (exacto) |
| 7.0 | 1.0 (exacto) |

Relacion: `w(6.7) / w(4) = 3.61`.

J por desviacion media `d`, `J = max(1, 7 - 1.5 d)`:

| d | J |
|---|---|
| sin atestaciones comparables (`null`) | 4.0 |
| 0 | 7.0 |
| 2 | 4.0 |
| 10 | 1.0 |

Mapeo de valor `v` (A.4.1): booleana `true`->7.0, `false`->1.0; `community` 1->1.0, 2->2.5, 3->4.0, 4->5.5, 5->7.0; fuera de 1..5 -> error. `reader_conduct`: `respected_policy`/`rate_respected`/`paid_as_agreed` con `val:true` -> 7.0 a su R; `policy_violation` con `val:true` -> 1.0 a R-01; `redistribution` con `val:true` -> 1.0 a R-04.

Peso de `self`: siempre 0.25, sea cual sea la J del sitio, y no alimenta el R-05 propio.

## V-09 — Puntaje bayesiano

`S = (3 * 4.0 + suma(w_i v_i)) / (3 + suma(w_i))`.

| # | Conjunto | S esperada | Suma de pesos |
|---|---|---|---|
| 1 | sin atestaciones | 4.0000 | 0 |
| 2 | 10 x (w(6)=0.694444…, v=7.0) | 6.0950 | 6.944444… |
| 3 | caso 2 + 1 x (w(4)=0.25, v=1.0) | 5.9700 | 7.194444… |
| 4 | 10 x (w(5)=0.444444…, v=4.0) | 4.0000 | 4.444444… |
| 5 | caso 4 + 1 x (w(6.7)=0.9025, v=3.0) | 3.8919 | 5.346944… |
| 6 | caso 4 + 1 x (w(6.7)=0.9025, v=1.0) | 3.6756 | 5.346944… |

Variaciones: caso 3 vs caso 2 = -2.05 %; caso 6 vs caso 4 = -8.11 %.

## V-10 — Calibracion de R-05 (leave-one-out, 8 rondas)

Cada ronda: consenso de los demas emisores del mismo (sujeto, dimension) **sin previo P**, desviacion absoluta media `d`, `J = max(1, 7 - 1.5 d)`; se parte de J = 4.0 para todos.

**Escenario S1** — 4 emisores honestos (`h1`..`h4`) puntuan 6.5 y un atacante pone 1.0, sobre 4 sujetos (`s1`..`s4`) en W-10:

| Emisor | J esperada |
|---|---|
| h1, h2, h3, h4 | 7.0 |
| attacker | 1.0 |

Peso resultante: honestos w = 1.0, atacante w = 0.0 (su ataque deja de mover el puntaje).

**Escenario S2** — `h1`,`h2` = 4.5; `h3`,`h4` = 3.5; atacante = 7.0, sobre los mismos 4 sujetos:

| Emisor | J esperada |
|---|---|
| h1, h2 | 6.2019 |
| h3, h4 | 5.8229 |
| attacker | 2.5570 |

Invariantes: `self` y las atestaciones de un emisor sobre si mismo no aparecen en el mapa de jueces; una dimension R-05 publicada cuenta sus atestaciones emitidas (no `self`) y su `weightSum` = cantidad de esas atestaciones; sin calificacion previa, R-05 = 4.0 con `weightSum` 0.

## V-11 — Politica de lectura y visibilidad

Politica por defecto (nivel gobernado): `require.identity = "apw_verified"`, R-01 `{min: 5.0, min_weight: 2.0}`, R-05 `{min: 5.0, min_weight: 2.0}`, `on_fail: "403"`. Recurso gobernable: `/trust/*` (tambien `/trust/:siteId`). Accion: solo `read`. Dimensiones conocidas: W-01..W-10 y R-01..R-05.

| # | Lector | Politica | Decision |
|---|---|---|---|
| 1 | anonimo (sin Web Bot Auth) | por defecto | denegar, status `401`, motivo `web_bot_auth_required` |
| 2 | Web Bot Auth valido, sin APW | por defecto | denegar, status `on_fail` (403), motivo `apw_identity_required` |
| 3 | APW no resoluble (`timeout`) | por defecto | denegar, status `on_fail`, motivo `history_unresolvable` |
| 4 | APW verificado, sin dimensiones (todo 4.0) | por defecto | denegar, `failed: ["R-01","R-05"]` |
| 5 | APW verificado, R-01 {5.6, peso 3}, R-05 {5.2, peso 6} | por defecto | **permitir** |
| 6 | APW verificado, R-01 {6.5, peso 0.5}, R-05 {5.2, peso 6} | por defecto | denegar, `failed: ["R-01"]` (puntaje alto con poco peso no alcanza) |
| 7 | cualquiera | politica con dimension desconocida o `min` fuera de 1..7 | denegar `403`, motivo `policy_invalid` |

Mientras R-05 este desactivado (`policyDimensions`), la politica por efecto exige solo R-01: los mismos casos 4, 5 y 6 evaluados unicamente contra R-01.

Proyeccion del `SiteTrustScore` (A.6): siempre como objeto `projection` = `{ dimensions, aggregates, governed }`.

- Conjunto W publico siempre: `W-01, W-04, W-06, W-07, W-09`. Gobernado por defecto: `W-02, W-03, W-05, W-08, W-10` y todas las R.
- Con lector rechazado: `projection` va en `public` (`public.projection`), `dimensions` = solo el conjunto publico (los overrides explicitos del dueno se sumarian si estuvieran configurados); `aggregates` = puntaje, cantidad y suma de pesos de **todas** las dimensiones con datos; `governed: "withheld"`.
- Con lector autorizado, o sin politica activa: `projection` en el cuerpo, `dimensions` = todas; `governed: "granted"`.
- Una dimension sin atestaciones no aparece en `dimensions` ni en `aggregates` (sin datos no es 4.0).
- El nivel publico nunca se puede ocultar por politica.

Caché y errores: resultado por (host, huella); 5 min si verifica, 60 s si falla. Tabla de politicas ilegible -> `503` en `GET /trust/:siteId`. Ningun error de resolucion abre el recurso.

## V-12 — `reader_conduct`

Categorias y mapeo a dimension (ademas de V-08): `respected_policy`->R-01, `policy_violation`->R-01 (inversa), `rate_respected`->R-02, `paid_as_agreed`->R-03, `redistribution`->R-04 (inversa). Categoria desconocida -> error.

Configuracion por defecto de la implementacion de referencia (ajustable, pero los defaults son estos):

| Clave | Valor |
|---|---|
| `emissionPeriod` | `month` |
| `policyDimensions` | `{"R-01": true, "R-05": false}` |
| `maxAttestationsLoaded` | `200` |
| `legacyEntriesWithoutJws` | `ignore` |
| `legacyCutoff` | `2026-10-04T00:00:00.000Z` |

`jti` determinista de emision: `rc-` + `base64url(SHA-256("<issuerDid>|<readerDid>|<period>|<cat>"))` sin padding. Clave de periodo UTC: mes `YYYY-MM`, dia `YYYY-MM-DD`, semana ISO `YYYY-Www`. Repetir la emision de un periodo devuelve los `jti` existentes como `already_emitted` en vez de duplicar.

Reglas de emision del ledger (defaults): `policy_violation` con `val: true` si `policyViolationsDetected > 0`; `respected_policy` con `val: true` si `requestsTotal > 0` y `policyViolationsDetected == 0`. Emision solo si `operatorKeyId` del solicitante es `k` del TXT del lector.

Completitud al cargar el historial de un lector:

| Situacion | Resultado |
|---|---|
| toda entrada de la cadena tiene su JWS y todo JWS tiene su hash en la cadena | carga valida |
| JWS cuyo hash no esta en la cadena | se descarta (no puede inventarse) |
| entrada sin JWS con `ts` >= `legacyCutoff` | completitud rota -> `apw_unresolvable` |
| entrada sin JWS con `ts` < corte, `legacyEntriesWithoutJws = "ignore"` | se ignora |
| entrada sin JWS con `ts` < corte, `legacyEntriesWithoutJws = "reject"` | `apw_unresolvable` |
| `reader_conduct` que no verifica contra las claves del emisor | `apw_unresolvable` (el lector no puede descartar sus negativas) |
| `reader_conduct` cuyo emisor es el propio lector | se excluye de la reputacion del lector |

Limite explicito: la completitud prueba que el lector no oculto atestaciones **ya anotadas**; no prueba omision en el origen ni *equivocation* (cadenas distintas a distintos visitantes).

---

## V-13 — Testigos (E-10, seccion 5.7)

Statement de testigo: JWS compacto, header `{ "alg": "EdDSA", "kid": "<did del testigo>#key-<n>", "typ": "apw-witness+jws" }`, payload en JCS:

```json
{ "typ": "apw-witness+jws", "iss": "did:apw:testigo.example", "sub": "did:apw:sujeto.example", "seq": 3, "head": "<43 chars>", "ts": "2026-10-09T12:00:00.000Z", "jti": "wt-<43 chars>" }
```

`jti` determinista: `wt-` + `base64url(SHA-256("<iss>|<sub>|<seq>|<head|''>"))` sin padding. Con `seq = 0` y `head = null`, el preimage termina en `|` vacio (`...|0|`).

Ejemplo de preimage (verificar contra tu propio SHA-256):

| iss | sub | seq | head | Preimage |
|---|---|---|---|---|
| `did:apw:testigo.example` | `did:apw:sujeto.example` | `0` | `null` | `did:apw:testigo.example\|did:apw:sujeto.example\|0\|` |
| `did:apw:testigo.example` | `did:apw:sujeto.example` | `3` | `AAAA...` (43 chars) | `did:apw:testigo.example\|did:apw:sujeto.example\|3\|AAAA...` |

Reglas de validacion del payload (ademas de firma y JCS, iguales que V-07):

| Situacion | Resultado |
|---|---|
| `seq > 0` y `head = null` | invalido |
| `seq = 0` y `head` con hash | invalido |
| `head` sin formato de 43 caracteres base64url | invalido |
| `jti` distinto del recomputado | `jti_mismatch` |
| `iss` != kid del header (DID del testigo) | invalido / `iss_mismatch` |
| statement no anotado en una cadena verificada del testigo | no cuenta como observacion |

Evaluacion: observacion anclada = `(witnessDid, seq, head, anchoredTs)`, donde `anchoredTs` es el `ts` de la entrada del historial DEL TESTIGO que contiene el statement. Cadena actual del sujeto = `[(seq, hash, ts), ...]` ya verificada (V-05). Margen de backdating: 300 s.

| # | Observaciones | Cadena actual del sujeto | Hallazgos esperados |
|---|---|---|---|
| 1 | `(testigo, 1, H1, 12:00)` | `[(1, H1, 11:00), (2, H2, 13:00)]` | ninguno (`ok`) |
| 2 | `(testigo, 1, H1, 12:00)` | `[(1, H9, 11:00)]` | `head_mismatch` seq 1: observado H1, actual H9 |
| 3 | `(testigo, 2, H2, 12:00)` | `[]` | `head_mismatch` seq 2: observado H2, actual `null` (truncamiento) |
| 4 | `(testigoA, 1, H1, 12:00)`, `(testigoB, 1, H9, 12:30)` | `[(1, H1, 11:00)]` | `equivocation` seq 1 (H1 vs H9) + `head_mismatch` de la observacion B |
| 5 | `(testigo, 1, H1, 12:00)` | `[(1, H1, 11:00), (2, H2, 11:54:00)]` | `backdated_entry` seq 2: entrada ts 11:54 vs observado 12:00 (> 300 s) |
| 6 | `(testigo, 1, H1, 12:00)` | `[(1, H1, 11:00), (2, H2, 11:58:00)]` | ninguno (11:58 esta dentro del margen de 300 s) |
| 7 | `(testigo, 0, null, 12:00)` | `[(1, H1, 10:00)]` | `backdated_entry` seq 1: la cadena estaba vacia a las 12:00 y la entrada declara 10:00 |

Un solo hallazgo basta: la cadena del sujeto no es confiable (fail-closed). La observacion de un testigo cuya propia cadena no verifica se descarta entera, no genera hallazgos.

---

## Como usar estos vectores

1. Implementa las formulas y reglas de `APW-SPEC-v1.3.md` con tus propias claves.
2. Ejecuta V-01, V-03 a V-06, V-08 a V-13 contra los valores de aqui; V-04, V-07 y V-13 con cualquier clave tuya (el `jti` y la evaluacion son independientes de la clave).
3. Publica tu propia conformidad citando el ID de cada vector que pasas. v1.3 exige V-01, V-03, V-05, V-06, V-08 y V-09 como minimos de interoperabilidad; el resto certifica cobertura completa.
