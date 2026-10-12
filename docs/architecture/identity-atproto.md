# Identidad AT Protocol y puente con APW — Estado Real

**Implementado como puente opcional (v0.0.9.10).**
`packages/identity-atproto/` dejo de ser un stub: hoy resuelve identidad
AT Protocol (handle <-> DID segun el spec) y la enlaza con la identidad
APW del sitio (`did:apw:<dominio>`) cuando el sitio **quiere** hacerlo.
Ninguno de los dos lados obliga al otro a existir: un sitio sin APW
resuelve igual su identidad AT, y un sitio APW sin vinculos AT no cambia
en nada su comportamiento.

## Que esta implementado hoy

En `packages/identity-atproto/src/`:

- `handle.ts` — sintaxis y normalizacion de handles AT, verbatim del spec
  (`atproto.com/specs/handle`): ASCII, max 253, dos segmentos minimo,
  case-insensitive. Dos niveles a proposito: `parseHandle()` valida solo
  sintaxis y `resolvableHandle()` agrega la restriccion de TLDs reservados
  (`.test`, `.localhost`, `.onion`, ...) — el spec dice que esos TLDs no
  fallan la validacion sintactica, fallan la **resolucion**.
- `resolve.ts` — resolucion bidireccional handle <-> DID del spec: TXT
  `_atproto.` preferido con fallback HTTPS, `did:plc` y `did:web`
  verificados contra el handle reclamado, clave de firma (multibase) y PDS
  (`#atproto_pds`). Nunca lanza: todo fallo vuelve como `reason`.
- `link.ts` — el vinculo entre un handle AT y un sitio APW con tres
  confianzas: `also_known_as` (el `did:apw` del sitio publica
  `alsoKnownAs: ["at://handle"]`), `self` (`@example.com` sobre
  `did:apw:example.com`) y `subdomain` (`@usuario.example.com` bajo
  `did:apw:example.com`).
- `reputation.ts` — el join completo (`buildAtprotoReputation`): identidad
  AT + reputacion W del sitio (local si esta misma instancia es el sitio,
  si no el endpoint publico `/trust/<siteId>` del sitio remoto, siempre la
  proyeccion **solo-publica**) + reputacion R del usuario si existe
  historial `reader_conduct` para `did:apw:<handle>` (sino `no_data`
  honesto, nunca un cero inventado). Cache 5 min en exito / 1 min en
  fallo por handle; todas las dependencias son inyectables.

Endpoints:

- `GET /trust/atproto/:handle` (`functions/trust/atproto/[handle].js`) —
  el join publico, mismo tratamiento que `GET /trust/:siteId` (publico,
  `access-control-allow-origin: *`, cache corta). 400 para sintaxis
  invalida o TLD reservado, 404 cuando no resuelve o el link no cierra,
  502 cuando el upstream de resolucion esta caido. Documentado en su
  propio test: nunca devuelve 500, los fallos de join degradan dentro de
  la respuesta 200.
- `GET/POST/DELETE /admin/api/apw-atproto-links`
  (`functions/admin/api/apw-atproto-links.js`) — CRUD admin (rol `admin`
  server-side, igual que `mcp-agents`) de los handles AT que el sitio
  reclama. Alta con `resolvableHandle()` (un handle que jamas va a resolver
  no se guarda), idempotente, normaliza a minusculas.

Puente APW -> AT:

- `/.well-known/did.json` del sitio incluye `alsoKnownAs:
  ["at://<handle>", ...]` cuando hay vinculos (el mismo campo W3C que AT
  Protocol ya lee en sus propios DID docs). Sin vinculos el documento sale
  **identico al formato historico** (retrocompatible).
- Store `site_atproto_links` (`packages/apw-resolver/src/did-apw/atproto-links-store.ts`,
  backends D1/SQLite/InMemory; DDL en `schema-additions/atproto-links.sql`,
  en el master `schema.sql` y en `REQUIRED_TABLES`).
- `document.ts` valida `alsoKnownAs` al parsear: un shape corrupto (no
  array, o con no-strings) invalida el documento completo.

Tests: `atproto-handle`, `atproto-resolve`, `atproto-link`,
`atproto-links-store`, `atproto-reputation`, `admin-atproto-links-endpoint`,
`trust-atproto-endpoint` (mas los casos de `alsoKnownAs` en
`apw-identity.test.ts`), ~130 tests nuevos.

## La vision del whitepaper que SIGUE sin implementar

- Repositorio de datos (PDS) propio por usuario, independiente del sitio.
- Lexicons propios de Portaless (`com.portaless.comment`, etc.)
  publicados bajo el dominio del sitio.
- App View propio (interpretacion del firehose de AT) — no existe un
  equivalente maduro de sistema de foros sobre AT en el ecosistema.

Esto sigue dependiendo de que Trust Layer (identidad de agentes) y
permisos esten maduros, porque la identidad de agentes de IA y la de
usuarios humanos comparten el mismo principio de verificacion
criptografica.

## Limites honestos

- **Resolucion de terceros**: el resultado depende de DNS y
  plc.directory; un outage ajeno se reporta como 502, no como exito.
- **Descubrimiento por sufijo de dominio**: `buildAtprotoReputation`
  solo encuentra vinculos `username.example.com -> example.com`
  (mas el claim explicito `alsoKnownAs`). La direccion inversa —
  "que sitio reclama este handle de OTRO dominio" — requiere un indice
  inverso: Portaless Index, futuro trabajo.
- **Reputacion R host-scoped**: `reader_conduct` vive en el host del
  lector; usuarios AT sin historial APW reportan `no_data`.
- **Confianza remota best effort**: la reputacion W del sitio remoto
  depende de que su `/trust/<siteId>` este accesible; si no, `trust: null`
  + `limitation site_trust_unreachable`.
- **Cache**: 5 min exito / 1 min fallo por handle en proceso (no
  compartido entre instancias).
