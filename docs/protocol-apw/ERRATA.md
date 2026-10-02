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
