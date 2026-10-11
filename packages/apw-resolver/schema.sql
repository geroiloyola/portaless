-- packages/apw-resolver/schema.sql
--
-- Fuente de verdad de site_identity -- ver packages/apw-resolver/src/did-apw/
-- site-identity-store.ts para la logica de cifrado/descifrado.
--
-- Identidad criptografica que ESTE sitio usa para firmarse a si mismo ante
-- terceros via Protocol APW (Wizard de onboarding, Paso 3-4). NO confundir
-- con authorized_agents (agentes EXTERNOS que Portaless autoriza a ACCEDER
-- a este sitio) ni con authorized_escrow_providers.
--
-- La clave privada NUNCA se persiste en texto plano: private_key_jwk_encrypted
-- guarda el JWK cifrado con AES-GCM. La clave de cifrado vive fuera de esta
-- base de datos (env var PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY).
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

-- Reputacion del lector (spec APW 6.4, ERRATA E-9): indice local de los jti
-- de reader_conduct que este sitio ya emitio, para no repetir una emision
-- del mismo periodo (jti determinista por emisor, lector, periodo y cat).
-- La fuente historica sigue siendo att_jws del historial encadenado (E-9):
-- en bases migradas el indice se siembra desde ahi (collectEmittedJtis) y
-- los stores D1/SQLite crean esta tabla al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS reader_conduct_jti (
  site_id TEXT NOT NULL,
  jti TEXT NOT NULL,
  period TEXT NOT NULL,
  cat TEXT NOT NULL,
  reader_did TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (site_id, jti)
);

-- Portaless Index, agregador de testigos (APW v1.3, 5.7 y seccion 7):
-- observaciones VERIFICADAS recopiladas de los testigos configurados por
-- sujeto (la ultima observacion anclada de cada testigo por seq, con su
-- fecha creible = ts de la entrada del historial DEL TESTIGO), la
-- ponderacion estatica por testigo (default 1.0; la calibracion estilo
-- A.4.4 queda pendiente) y la ultima entrada de directorio cacheada, que
-- publica /.well-known/apw-index.json sin re-bajar cadenas por request.
-- Los stores D1/SQLite crean estas tablas al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS witness_observations (
  site_id TEXT NOT NULL,
  subject_did TEXT NOT NULL,
  witness_did TEXT NOT NULL,
  observed_seq INTEGER NOT NULL,
  observed_head TEXT,
  anchored_ts TEXT NOT NULL,
  statement_jti TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, subject_did, witness_did, observed_seq)
);

CREATE TABLE IF NOT EXISTS witness_weights (
  site_id TEXT NOT NULL,
  witness_did TEXT NOT NULL,
  weight REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, witness_did)
);

CREATE TABLE IF NOT EXISTS witness_index_subjects (
  site_id TEXT NOT NULL,
  subject_did TEXT NOT NULL,
  domain TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, subject_did)
);
