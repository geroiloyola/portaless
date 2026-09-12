# Identidad y Comunidad vía AT Protocol — Estado Real

**NO IMPLEMENTADO.** `packages/identity-atproto/` en este repositorio es
un stub — estructura de carpetas (`lexicons/`, `src/pds-client/`,
`src/appview/`, `src/comments/`) sin lógica funcional.

## Diseño previsto (whitepaper)

- Cada usuario tiene un DID y un repositorio de datos (PDS) propio,
  independiente del sitio.
- Comentarios y reputación se modelan como Lexicons propios de Portaless
  (`com.portaless.comment`, etc.), publicados bajo el dominio del sitio.
- Requiere construir un "App View" propio (interpretación del firehose de
  ATProto) — no existe todavía un equivalente maduro de sistema de foros
  sobre este protocolo en el ecosistema en general.

## Por qué no se implementó todavía

Depende de que el Trust Layer (identificación de agentes) y el sistema de
permisos estén maduros primero, dado que la identidad de agentes de IA y
la identidad de usuarios humanos comparten el mismo principio de
verificación criptográfica.
