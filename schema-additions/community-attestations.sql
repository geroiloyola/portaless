-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Community attestations (APW v1.3, ERRATA E-13)
-- -----------------------------------------------------------------------------
-- Anexo append-only de las atestaciones comunitarias firmadas por un Veracier
-- (did:apw). Es la fuente que PUNTUA. La tabla site_trust_community_votes sigue
-- existiendo como opinion de visitante, visible y fuera del scoring: no tiene
-- identidad verificable y por eso no entra a ninguna dimension.
--
-- La clave primaria es (iss, jti): 5.3 exige jti unico POR EMISOR, no global,
-- y una fila nunca pisa a otra. El scoring toma la ultima por (iss, sub, cat)
-- en tiempo de lectura (E-13), asi que reemitir agrega, no sobreescribe.
--
-- emitter_first_seen_iat es el ts de la primera entrada verificada del
-- historial del emisor (5.4), capturado al recibir la atestacion. Es NULL si no
-- se pudo resolver; en ese caso el emisor NO acredita antiguedad (fail-closed,
-- E-13) y su atestacion se registra igual para que quede como dato publico.

CREATE TABLE IF NOT EXISTS community_attestations (
  iss TEXT NOT NULL,
  jti TEXT NOT NULL,
  site_id TEXT NOT NULL,
  sub TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'perceived_trustworthiness', 'content_accuracy', 'spam_or_deceptive', 'responsiveness'
  )),
  val INTEGER NOT NULL CHECK (val BETWEEN 1 AND 5),
  iat INTEGER NOT NULL,
  jws TEXT NOT NULL,
  emitter_first_seen_iat INTEGER,
  received_at TEXT NOT NULL,
  PRIMARY KEY (iss, jti)
);

CREATE INDEX IF NOT EXISTS idx_community_attestations_subject
  ON community_attestations(site_id, category);

CREATE INDEX IF NOT EXISTS idx_community_attestations_emitter
  ON community_attestations(iss, iat);
