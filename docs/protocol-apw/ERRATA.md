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
- **JWS**: compacto, header `{ "alg": "EdDSA", "kid": "<huella de la clave del sitio>", "typ": "apw-log+jws" }`. `kid` es la misma huella RFC 7638 que `k` (E-1).
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
