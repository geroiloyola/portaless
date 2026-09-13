-- Esquema de persistencia real para @portaless/permissions.
-- Aplicar via Cloudflare D1 (wrangler d1 execute --file=schema.sql)
-- o contra un archivo SQLite local para despliegues self-hosted.

CREATE TABLE IF NOT EXISTS permission_grants (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_display_name TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  granted INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (subject_type, subject_id, capability_id)
);

CREATE INDEX IF NOT EXISTS idx_grants_capability ON permission_grants(capability_id);
