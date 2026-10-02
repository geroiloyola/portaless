-- packages/apw-resolver/schema.sql
--
-- Fuente de verdad de site_identity -- ver packages/apw-resolver/src/did-apw/
-- site-identity-store.ts para la logica de cifrado/descifrado, y el
-- schema.sql maestro (raiz del repo) para el comentario completo de diseño.
--
-- Este archivo se concatena al maestro via scripts/generate-schema.mjs.
-- No aplicar directamente contra una base de datos en produccion -- usar
-- siempre el schema.sql maestro o node scripts/setup.mjs.

CREATE TABLE IF NOT EXISTS site_identity (
  site_id TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  private_key_jwk_encrypted TEXT NOT NULL,
  private_key_encryption_iv TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- APW v1.2, seccion 5.4: historial de claves del sitio. site_identity guarda
-- la clave ACTUAL; aca queda cada clave que el sitio tuvo, con su ventana
-- valid_from / valid_to, para verificar entradas viejas del historial
-- encadenado despues de rotar. kid = huella RFC 7638 de la clave publica.
-- La privada solo existe en la clave activa: al rotar se pone en NULL.
-- El indice parcial impide dos claves activas a la vez por sitio.
--
-- ERRATA E-3: key_id = did:apw:<dominio>#key-<n> (el `kid` de los JWS que firma
-- el sitio) y key_sequence = <n>, unico por sitio. Las bases creadas por el
-- PR #71 no tienen estas columnas: el store las agrega solo (ALTER TABLE) y
-- asigna #key-1, #key-2... por fecha de alta.
-- Los stores tambien crean estas tablas al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS site_identity_keys (
  kid TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  private_key_encrypted TEXT,
  private_key_encryption_iv TEXT,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  key_id TEXT,
  key_sequence INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_active
  ON site_identity_keys(site_id) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_identity_keys_site
  ON site_identity_keys(site_id, valid_from);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_seq
  ON site_identity_keys(site_id, key_sequence);

-- APW v1.2, seccion 5.4: historial encadenado. Una fila por entrada; entry_jws
-- es la fuente de verdad (los verificadores recalculan hashes y firmas).
-- PK (site_id, seq): dos escrituras simultaneas no pueden bifurcar la cadena.
-- Indice unico (site_id, att_hash): la misma atestacion no se registra dos veces.
-- kid = huella RFC 7638 de la clave que firmo la entrada.

CREATE TABLE IF NOT EXISTS site_attestation_log (
  site_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_jws TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  prev_hash TEXT,
  att_hash TEXT NOT NULL,
  kid TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (site_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_attestation_log_att
  ON site_attestation_log(site_id, att_hash);
