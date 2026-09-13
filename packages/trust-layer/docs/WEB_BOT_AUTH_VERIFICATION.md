# Verificacion Criptografica Real de Web Bot Auth (RFC 9421)

## Que cambio

verify.ts ya no se limita a resolver el directorio de claves -- ahora valida criptograficamente la firma (RFC 9421, Ed25519).

## Flujo

1. Lee Signature-Agent, Signature-Input, Signature.
2. Parsea Signature-Input (keyid, alg, componentes, created/expires).
3. Rechaza si alg != ed25519, si expiro, o si supera 5 minutos.
4. Resuelve el directorio de claves del operador.
5. Reconstruye la signature base y verifica con crypto.subtle.verify.

## Archivos nuevos

- rfc9421.ts: parsing RFC 9421 + verificacion Ed25519.
- verify.ts: reemplazado, mismo contrato {verified, reason, keyRecord}.

## Limitaciones

- Solo Ed25519. Sin cache del directorio. Sin verificacion de nonce unico.
