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
