# Protocol APW — Erratas

Correcciones a la especificacion publicada. Cada errata reemplaza el texto indicado; el resto del documento sigue vigente.

## E-1 — Calculo de la huella `k` (APW v1.2, seccion 5.1)

**Fecha**: Octubre 2026

**Texto original**: `k = base64url(SHA-256(JCS(publicKeyJwk)))`.

**Problema**: el JWK que exporta WebCrypto puede traer miembros opcionales (`key_ops`, `ext`, `alg`, `kid`) que varian segun la implementacion. Canonicalizar el JWK completo haria que dos verificadores calculen huellas distintas para la misma clave.

**Texto vigente**: `k` es el **JWK Thumbprint de RFC 7638** con SHA-256, en base64url sin padding. Se calcula solo sobre los miembros obligatorios de la clave, en orden lexicografico y sin espacios. Para Ed25519 (`kty: "OKP"`, RFC 8037) son `crv`, `kty` y `x`:

```
{"crv":"Ed25519","kty":"OKP","x":"<x>"}
```

Es el mismo calculo que usa Web Bot Auth para el `keyid`, asi que la huella APW de un agente coincide con su `keyid` (seccion 6.3).

**Vectores de prueba**:

| Clave | `x` | Huella esperada |
|---|---|---|
| RFC 8037, Apendice A | `11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo` | `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k` |
| RFC 9421, Apendice B.1.4 | `JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs` | `poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U` |

**Implementacion**: `packages/apw-resolver/src/did-apw/fingerprint.ts` (`jwkThumbprint()`).

## E-2 — Precisiones del historial encadenado (APW v1.2, seccion 5.4)

**Fecha**: Octubre 2026

**Alcance**: la seccion 5.4 define el payload `{ seq, prev, att, ts }`, que `prev` es el hash de la entrada anterior y que el hash de la ultima entrada se publica como `h`. No fija los detalles que dos implementaciones necesitan para interoperar. Quedan definidos asi:

- **Hash**: `base64url(SHA-256(jws))` sin padding, calculado sobre el JWS compacto tal cual (43 caracteres). Aplica a `prev`, `att` y `h`.
- **Primera entrada**: `seq: 1` y `prev: null`.
- **JWS**: compacto, header `{ "alg": "EdDSA", "kid": "<huella de la clave del sitio>", "typ": "apw-log+jws" }`. `kid` es la misma huella RFC 7638 que `k` (E-1). *(Reemplazado por E-3 para las entradas nuevas.)*
- **`ts`**: ISO 8601 en UTC. No puede ser anterior al `ts` de la entrada previa.
- **Publicacion**: `GET /.well-known/apw-log.json`, paginado con `?from=<seq>&limit=<n>` (maximo 500). Devuelve `did`, `head`, `length`, `keys`, `entries` (`{ seq, jws }`) y `next`.

**Rotacion de claves**: rotar no invalida el historial. El sitio conserva cada clave publica que uso con su ventana `validFrom` / `validTo` y la publica en `keys`. Una entrada se verifica contra la clave que indica su `kid`, siempre que su `ts` caiga dentro de la ventana de esa clave (extremos incluidos). La clave privada de una clave retirada se elimina al rotar.

**Anclaje en el DNS**:

- `k` del TXT debe ser la clave activa (`validTo: null`) del log. Asi el DNS ata la lista de claves.
- `h` del TXT debe ser el hash de alguna entrada de la cadena. Si no aparece, se borro o altero una entrada ya publicada (`head_mismatch`).
- Las entradas posteriores a `h` son validas pero todavia no estan ancladas: `h` cambia con cada atestacion y el TXT se actualiza a mano. Un verificador debe informar cuantas entradas quedan sin anclar.

**Limitaciones que siguen vigentes**:

- No detecta omisiones (seccion 7, testigos externos).
- `ts` lo declara el propio sitio. Con una clave comprometida se podrian firmar entradas con fechas viejas dentro de la ventana de esa clave; el anclaje de `h` en el DNS y los testigos externos acotan ese riesgo.

**Implementacion**: `packages/apw-resolver/src/did-apw/history-log.ts` (`appendAttestation()`, `verifyChain()`) y `history-resolver.ts` (`resolveApwHistory()`).

## E-3 — Identificador DID de la clave en los JWS del sitio (APW v1.2, secciones 5.2 y 5.4)

**Fecha**: Octubre 2026

**Problema**: la seccion 5.2 exige que todo JWS firmado por el sitio lleve `kid: "did:apw:<dominio>#key-1"`. E-2 definio el `kid` de las entradas del historial como la huella RFC 7638, que es el identificador de `k`. Son dos cosas distintas: el `kid` de un JWS debe poder resolverse a un `verificationMethod` del documento DID, y la huella sirve para enlazar la clave con el TXT.

**Texto vigente**: cada clave del sitio tiene dos identificadores y los publica ambos.

| Campo | Valor | Uso |
|---|---|---|
| `keyId` | `did:apw:<dominio>#key-<n>` | `kid` del header de todo JWS que firma el sitio |
| `keySequence` | `<n>`, entero desde 1, unico por sitio | Crece con cada rotacion; no se reutiliza |
| `fingerprint` | huella RFC 7638 (E-1) | Se compara con `k` del TXT. Se publica tambien como `kid`, por compatibilidad |

**Verificacion**:

- Una entrada se resuelve por el `kid` de su header, que puede ser el `keyId` o, en entradas anteriores a E-3, la huella.
- El `keyId` debe tener el formato `did:apw:<dominio>#key-<n>` con `<n>` entero positivo sin ceros a la izquierda, y el DID debe ser el del dominio verificado.
- Dos claves no pueden compartir identificador (ni un `keyId` puede coincidir con la huella de otra).
- La huella publicada debe ser el thumbprint de la clave publica; `k` del TXT debe coincidir con la huella de la clave activa.

**Transicion**: las entradas del historial creadas antes de E-3 se conservan sin cambios y siguen verificando por su huella. Las entradas nuevas firman con el `keyId`. Las claves existentes reciben `#key-1`, `#key-2`... segun su fecha de alta. La columna `kid` del log sigue guardando la huella de la clave que firmo.

**No incluido**: el manifiesto extendido firmado (`/.well-known/apw-manifest.jws`, seccion 5.2) requiere JCS (RFC 8785) y se publica en un cambio aparte, con una dependencia auditada.

**Implementacion**: `packages/apw-resolver/src/did-apw/key-id.ts` (`didKeyId()`, `parseDidKeyId()`), `site-identity-store.ts` y `history-log.ts`.

## E-4 — Entrega y verificacion de atestaciones del emisor (APW v1.2, seccion 5.3)

**Fecha**: Octubre 2026

**Alcance**: la seccion 5.3 define el payload de la atestacion y quien la firma, pero no como se entrega ni que se valida. Quedan definidos asi para `agent` y `escrow_report`.

**Entrega**: el JWS compacto va en `body.attestation`, junto a los campos planos de siempre. Los campos planos tienen que coincidir con el payload firmado; si no coinciden, se responde `400 attestation_mismatch`. La firma manda: un cuerpo plano distinto nunca se acepta.

| Fuente | Endpoint | Clave que verifica | `iss` | Coincidencia exigida |
|---|---|---|---|---|
| `agent` | `POST /trust/:siteId/agent-verification` | La del directorio Web Bot Auth del agente; `kid` del header = `keyid` de la firma HTTP | Origen de `Signature-Agent` | `cat` = `category`, `val` = `verified` |
| `escrow_report` | `POST /trust/:siteId/escrow-report` | `public_key_jwk` registrada del proveedor | `escrowProvider` | `cat` = `transactionOutcome`, `val` = `true` |

**Validaciones** (en este orden):

- Header: `alg` = `EdDSA`; si trae `typ`, debe ser `apw-attestation+jws`.
- Clave Ed25519 (`kty: "OKP"`). Las claves ML-DSA no se aceptan para atestaciones.
- Firma valida sobre los bytes recibidos. El receptor no canonicaliza el payload.
- Payload: `typ` = `apw-attestation+jws`; `sub` = `did:apw:<siteId>`; `src` = la fuente del endpoint; `iss` como en la tabla (las URLs https se comparan por origen).
- `iat` dentro de +-300 segundos del reloj del receptor.
- `jti` (1 a 128 caracteres ASCII visibles) unico por emisor. Un `jti` repetido responde `409 duplicate_attestation`.

La autenticacion previa no cambia: `agent` sigue exigiendo Web Bot Auth y la allowlist `authorized_agents`; `escrow_report` sigue exigiendo la API key. Un proveedor sin `public_key_jwk` queda autorizado pero no puede reportar (`403 provider_without_public_key`).

**Persistencia**: el JWS se guarda completo en la fila existente de SiteTrustScore (`attestation_jws`, `attestation_jti`), sin un store paralelo. Si `sub` es el DID del propio sitio, el JWS se anota ademas en el historial encadenado (5.4). Si el historial falla, el reporte igual queda guardado y la respuesta lo indica con `logged: false`. Las filas anteriores a E-4 quedan con `attestation_jws` vacio: no son verificables por terceros.

**No incluido**: las atestaciones `self` las firma el propio sitio y requieren JCS (5.2); van junto con `/.well-known/apw-manifest.jws`. `community` queda fuera de la cadena en el MVP (B7).

**Implementacion**: `packages/trust-layer/src/site-trust/attestation.ts` (`verifyAttestation()`), `functions/trust/[siteId]/agent-verification.js`, `escrow-report.js` y `packages/apw-resolver/src/did-apw/record-attestation.ts`.

## E-5 — Artefactos firmados por el sitio: JCS, manifiesto extendido y `self` (APW v1.2, secciones 5.2 y 5.3)

**Fecha**: Octubre 2026

**Alcance**: cierra B3 y lo que E-3 y E-4 dejaron como "No incluido". La seccion 5.2 dice que todo artefacto del sitio es un JWS con payload JCS y que el primero es el manifiesto extendido, pero no fija el `typ`, el payload exacto ni como se verifica. Quedan definidos asi.

**Texto reemplazado en 5.2**: `kid: "did:apw:<dominio>#key-1"` pasa a ser `kid` = `keyId` de la clave activa, `did:apw:<dominio>#key-<n>` (E-3). Con una sola clave es `#key-1`; despues de rotar, firmar con `#key-1` haria imposible encontrar la clave correcta.

**Firma (emisor = el sitio)**:

- JWS compacto (RFC 7515), header `{ "alg": "EdDSA", "kid": "<keyId>", "typ": "<typ>" }`. El header tambien se serializa con JCS.
- Payload serializado con **JCS (RFC 8785)** antes de firmar. Solo valores I-JSON: el emisor rechaza `undefined`, `NaN`, `Infinity`, `bigint`, funciones y objetos que no sean planos, en vez de omitirlos o convertirlos.
- El `kid` debe pertenecer al DID del firmante: un sitio no firma con un `keyId` de otro dominio.

**Verificacion de un artefacto del sitio**:

- `alg` = `EdDSA`, `typ` y `kid` exactamente los esperados.
- Firma valida con la clave publica de ese `kid` (del documento DID o de `keys` del log, E-2/E-3).
- El payload recibido debe estar **en forma JCS**: si `JCS(JSON.parse(payload))` no reproduce los bytes firmados, se rechaza (`not_canonical`). Esto es mas estricto que E-4, donde el receptor no canonicaliza, porque aca el emisor es siempre una implementacion APW y JCS es obligatorio.

**Manifiesto extendido**: `GET /.well-known/apw-manifest.jws`.

- `typ`: `apw-manifest+jws`. Respuesta `application/jose`, publica (sin Web Bot Auth), cache corta.
- Payload: los mismos campos del TXT `_apw.<dominio>` (`v`, `siteId`, `trustUrl`, `contentKinds`, `k`, `h`, y `rg` cuando exista) mas `did` (el DID del sitio) e `iat` (segundos Unix). TXT y manifiesto salen de la misma funcion, asi que no pueden divergir.
- Un resolver acepta el manifiesto si: la firma verifica con la clave del `kid`; la huella RFC 7638 de esa clave es `k` del TXT; y `siteId`, `trustUrl`, `contentKinds` y `k` coinciden con el TXT.
- `h` del manifiesto puede ser **mas nuevo** que el del TXT: el manifiesto se firma con la cabeza actual del historial y el TXT se actualiza a mano. No se exige igualdad; el resolver verifica que el `h` del TXT aparezca en la cadena y que la cadena llegue hasta el `h` del manifiesto (las entradas intermedias quedan sin anclar, E-2).
- Sin identidad responde `404 site_identity_not_found`, igual que `did.json`.

**Atestaciones `self`**: mismo formato que 5.3 y E-4.

- `iss` = `sub` = `did:apw:<dominio>` del sitio; `src` = `self`; `cat` = categoria declarada; `val` = valor declarado; `jti` aleatorio.
- Header `typ`: `apw-attestation+jws`, `kid` = `keyId` activo. Se verifican con el mismo `verifyAttestation()` de E-4, usando la clave del `kid` y `iss` = el DID del sitio.
- **Persistencia**: el JWS se guarda en la fila existente de `site_trust_self_evaluations` (`attestation_jws`, `attestation_jti`), sin store paralelo, como en E-4. La fila es upsert por categoria y guarda la atestacion **vigente**; las anteriores quedan en el historial encadenado, donde se anota cada declaracion.
- Si el sitio no tiene identidad, la declaracion se guarda sin JWS y la respuesta informa `signed: false`. La firma es aditiva: no bloquea al admin que no completo el wizard. Esas filas no son verificables por terceros.
- `self` sigue siendo la senal mas debil (peso fijo 0.25 en el Anexo A, A.4.2); la firma la hace atribuible, no mas confiable.

**Dependencia**: JCS se implementa con el paquete `canonicalize`, listado en RFC 8785 como implementacion JavaScript de referencia.

**Implementacion**: `packages/apw-resolver/src/did-apw/site-jws.ts` (`jcs()`, `signSiteJws()`, `verifySiteJws()`, `signSelfAttestation()`, `signSiteManifest()`), `site-manifest.ts` (`buildSiteManifest()`), `functions/.well-known/apw-manifest.jws.js`, `functions/admin/site-trust/[siteId]/self.js` y los stores D1/SQLite de SiteTrustScore.

## E-6 — Ejemplo del sitio A (Anexo A, A.4.4)

**Fecha**: Octubre 2026

**Problema**: el ejemplo dice que el sitio A tiene 6.10 en W-10 con 10 atestaciones de emisores con J = 6.0 (w = 0.69). Con P = 3 ese valor es inalcanzable: aun si las 10 atestaciones valen 7.0, el puntaje maximo es (3 x 4.0 + 6.944 x 7.0) / (3 + 6.944) = 6.095. Llegar a 6.10 exigiria atestaciones de 7.007, fuera de la escala.

**Texto vigente**: el sitio A tiene **6.095** en W-10 con 10 atestaciones de 7.0 de emisores con J = 6.0 (w = 25/36 = 0.694). Un emisor con J = 4.0 lo ataca con un 1.0: A baja a **5.970** (-2.05%). El ejemplo del sitio B no cambia (3.892 con un 3.0; 3.676 con un 1.0). La conclusion tampoco: por cada punto de desviacion, un emisor de 6.7 (w = 0.9025) mueve el puntaje 3.61 veces mas que uno de 4.0.

**Vectores de prueba**: `w(4) = 0.25`, `w(6.7) = 0.9025`, `w(1) = 0`; sitio A 6.0950 -> 5.9700; sitio B 3.8919 y 3.6756; sin atestaciones, 4.0.

**Implementacion**: `packages/apw-resolver/src/scoring/scoring.ts` (`issuerWeight()`, `bayesianScore()`) y `scoring.test.ts`.

## E-7 — Calibracion de R-05 (Anexo A, A.4.3)

**Fecha**: Octubre 2026

**Problema 1**: A.4.3 dice que J es mayor cuanto menor es la desviacion media, pero no da la funcion.

**Problema 2**: compara cada atestacion contra "el puntaje de la dimension evaluada sin contarla". Ese puntaje incluye el previo P = 3 en 4.0, que lo tira hacia el neutro. Un evaluador honesto que califica alto algo realmente bueno queda lejos de ese puntaje y pierde peso. Con 4 emisores honestos que califican 6.5 a cuatro sitios y un atacante que les pone 1.0, la regla literal da J = 3.98 a los honestos (peor que un emisor nuevo) y J = 1.57 al atacante.

**Texto vigente**:

- `J = max(1, 7 - 1.5 x d)`, donde `d` es la desviacion absoluta media de las atestaciones del emisor en la escala 1 a 7. Un emisor sin atestaciones comparables queda en J = 4.0.
- La desviacion de cada atestacion se mide contra el **promedio ponderado de los demas emisores** sobre el mismo sujeto y dimension, **sin el previo P** (leave-one-out). P se sigue usando para el puntaje publicado (A.4.3), no para calibrar.
- J se calcula por punto fijo: se parte de J = 4.0 para todos y se itera (8 rondas en esta version), porque el peso de cada emisor depende del J de los demas.
- No cuentan para el R-05 propio: las atestaciones `self` ni las de un emisor sobre si mismo. Si los demas emisores no tienen peso, la atestacion no se compara.

Con esta regla, el escenario anterior da J = 7.0 a los honestos y J = 1.0 al atacante. Con honestos en 4.5 y 3.5 y un atacante en 7.0: honestos 6.2 y 5.8, atacante 2.56.

El factor 1.5, el numero de rondas y P son valores por defecto de esta version, ajustables con nuevos vectores de prueba.

**Implementacion**: `packages/apw-resolver/src/scoring/scoring.ts` (`judgeFromDeviation()`, `calibrateJudges()`).

## E-8 — Almacenamiento y aplicacion de la politica de lectura (APW v1.2, secciones 6.3, 6.5 y 6.9)

**Fecha**: Octubre 2026

**Texto original (6.5)**: las politicas se administran desde el Centro de Permisos con la capacidad `trust:read-governance`.

**Problema**: el Centro de Permisos guarda grants (sujeto x capacidad). La politica de lectura no es un permiso de un actor: es la configuracion global del sitio, una por `siteId`.

**Texto vigente**:

- La politica vive en su propia tabla tipada, `site_trust_read_policies`: `enabled`, `require_apw_identity` (fijo en 1), `min_r01`, `min_r01_weight`, `min_r05`, `min_r05_weight`, `on_fail` (`401`, `402` o `403`). Los valores por defecto son los de A.6.
- Sin fila, o con `enabled = 0`, la lectura es publica (A.6).
- El Centro de Permisos se reserva para **excepciones por lector**: un grant `trust:read-governance-bypass` sobre el DID de un lector le permite leer aunque no cumpla los umbrales. Ese grant no se implementa en este cambio.
- El manifiesto solo anuncia `rg: true`; la politica completa nunca se publica.

**Identidad del lector (6.3)**: se exige que la huella RFC 7638 de la clave que firmo la request Web Bot Auth sea `k` del TXT del origen `Signature-Agent`, y que su historial verifique. En el MVP solo se acepta la clave activa (`k`); las claves no activas listadas en `did.json` quedan fuera. Estados: sin firma valida -> `401`; firma valida sin APW -> `on_fail`; APW que no se puede comprobar -> `on_fail`; APW verificado -> se evaluan los umbrales.

**Aplicacion (6.9)**: el resultado se cachea por host y huella (5 minutos si verifica, 60 segundos si falla). Cualquier error de resolucion aplica `on_fail`; nunca se abre por defecto. Si la tabla de politicas no se puede leer, `GET /trust/:siteId` responde `503`. Al rechazar, la respuesta incluye lo que siempre es publico (`verification` y cantidad de filas por fuente); la proyeccion de las dimensiones W publicas queda pendiente.

**Pendiente en el MVP**: la carga de `reader_conduct` desde el historial del lector. Hasta entonces todo lector verificado tiene R-01 y R-05 neutros (4.0, peso 0), asi que una politica activa con umbrales rechaza a todos los lectores.

**Implementacion**: `packages/apw-resolver/src/scoring/read-policy-store.ts`, `reader-identity.ts`, `policy.ts`, `functions/trust/[siteId].js` y `functions/_middleware.js` (`context.data.webBotAuth`).

## E-9 — Reputacion del lector: reader_conduct publicado y completitud (LTP v1.2, 6.4; cierra el pendiente de E-8)

**Fecha**: Octubre 2026

**Problema**: E-8 dejo pendiente la carga de `reader_conduct`: todo lector verificado tenia R-01 y R-05 neutros, y una politica activa rechazaba a todos. El historial (5.4) solo guarda el hash de cada atestacion, asi que nadie puede leer su contenido.

**Texto vigente**:

- **Paquete publico**: el historial guarda el JWS completo de cada atestacion (`att_jws`) y lo publica en `GET /.well-known/apw-attestations.json` (`{ did, entries: [{ seq, att, jws }], next }`). La entrada firmada del log no cambia: sigue conteniendo solo el hash.
- **Carga del lector**: quien evalua verifica la cadena del lector (5.4), baja el paquete y exige:
  - que cada JWS tenga su hash `att` en la cadena (no se puede inventar ni alterar);
  - completitud: que cada `att` de la cadena tenga su JWS (no se puede ocultar una `policy_violation` ya anotada).
  - Las entradas con `ts` anterior a `legacyCutoff` (2026-10-04) pueden no tener JWS; segun `legacyEntriesWithoutJws` se ignoran o rompen la completitud.
- Cada `reader_conduct` con `sub` igual al DID del lector, y cuyo emisor no sea el propio lector, se verifica con `verifyAttestation()` (E-4) contra las claves publicadas del emisor. La clave activa debe ser `k` de su TXT y el `iat` debe caer dentro de la ventana de la clave. La ventana de +-300 s sobre `iat` no aplica al leer del historial (`skipIatWindow`): el `ts` firmado de la cadena prueba cuando se anoto.
- **Fail-closed**: si una `reader_conduct` no se puede verificar, el lector queda `apw_unresolvable` con motivo `reader_conduct_*`. Un lector no puede descartar sus negativas alegando que no verifican.
- **Emision**: el sitio registra en el ledger el DID candidato del lector (`did:apw:<host de Signature-Agent>`, sin verificar). `POST /admin/api/reader-conduct/emit` (admin + step-up) emite por periodo solo si `operatorKeyId` es `k` del TXT del lector. Firma con la clave activa (E-3), usa un `jti` determinista (emisor, lector, periodo, categoria) y anota cada emision en el historial propio: el emisor publica lo que emitio.

**Limitaciones**:

- Omision en el origen: un lector puede no anotar desde el principio una atestacion que recibio. Que el emisor publique lo que emitio permite detectarlo comparando; automatizarlo requiere testigos (seccion 7).
- Equivocation: un lector podria mostrar cadenas distintas a distintos visitantes. Lo acotan el anclaje de `h` en el DNS y los testigos externos.
- `ts` lo declara el propio lector (E-2): uno nuevo podria fechar entradas antes de `legacyCutoff` para esquivar la completitud.
- R-05 arranca apagado (`policyDimensions`): un sitio solo no ve suficientes evaluadores para calibrar (A.4.3).

**Como actualizar** (`packages/apw-resolver/src/scoring/reader-conduct-config.ts`):

- Exigir R-05: `policyDimensions["R-05"] = true`, sin migracion.
- Nuevas categorias: agregar una regla en `CONDUCT_RULES` cuando el ledger tenga el dato.
- Endurecer historiales viejos: `legacyEntriesWithoutJws = "reject"`.
- Emitir mas seguido que una vez por mes requiere un ledger con esa granularidad.

**Implementacion**: `scoring/reader-attestations.ts` (`loadReaderConduct()`), `reader-conduct-emitter.ts`, `reader-conduct-config.ts`, `reader-identity.ts`, `did-apw/history-resolver.ts` (`includeEntries`), `trust-layer/site-trust/attestation.ts` (`skipIatWindow`), el ledger (`reader_did`), `functions/_middleware.js` y `functions/admin/api/reader-conduct/emit.js`.
