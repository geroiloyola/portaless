-- Esquema de persistencia real para @portaless/auth.
-- Aplica esto vía Cloudflare D1 (wrangler d1 execute --file=schema.sql)
-- o contra un archivo SQLite local para despliegues self-hosted.

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
