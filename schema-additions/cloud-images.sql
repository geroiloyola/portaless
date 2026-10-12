-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Cloud Images + APW como SSOT criptografico
-- -----------------------------------------------------------------------------
-- Registro de imagenes publicadas por el sitio: metadata firmada (sidecar
-- JWS Ed25519 typ apw-image+jws, ver packages/cloud-images/src/sign.ts) +
-- bytes de la imagen en una sola fila. content_hash es UNICO: subir la
-- misma imagen otra vez devuelve la existente (dedupe). El desacople de
-- bytes a R2 queda como item externo del ROADMAP: moverlos = migrar la
-- columna a un bucket con la misma interface de bytes, sin tocar formato
-- ni endpoints. Ver docs/architecture/cloud-images.md.

CREATE TABLE IF NOT EXISTS cloud_images (
  image_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  declared_origin TEXT NOT NULL,
  site_id TEXT NOT NULL,
  site_did TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  signed_at TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_images_content_hash ON cloud_images (content_hash);
