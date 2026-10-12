-- -----------------------------------------------------------------------------
-- v0.0.9.32 -- Vinculos opcionales APW <-> AT Protocol (alsoKnownAs)
-- -----------------------------------------------------------------------------
-- Handles AT que el sitio reclama en su propio documento did:apw
-- (campo estandar W3C `alsoKnownAs`, el mismo que lee el ecosistema AT
-- Protocol). Publicados en /.well-known/did.json.js; gestionados desde
-- /admin/api/apw-atproto-links. Sin filas = sin campo = documento
-- identico al de antes (el puente es 100% opcional). El lado de
-- resolucion/join vive en packages/identity-atproto/. Ver
-- docs/architecture/identity-atproto.md.

CREATE TABLE IF NOT EXISTS site_atproto_links (
  site_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (site_id, handle)
);
