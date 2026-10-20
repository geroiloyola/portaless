-- Esquema de persistencia real para @portaless/auth.
-- Aplica esto vía Cloudflare D1 (wrangler d1 execute --file=schema.sql)
-- o contra un archivo SQLite local para despliegues self-hosted.

-- v0.0.9.10: columnas de email, 2FA (TOTP) y OAuth -- antes solo existian
-- en InMemoryUsersStore; los stores reales (SQLite/D1) las agregan solas
-- con ALTER TABLE en bases viejas (mismo patron que site_identity_keys).
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email TEXT,
  provider TEXT,
  totp_secret TEXT,
  totp_enabled_at TEXT,
  oauth_provider TEXT,
  oauth_subject TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

-- Challenges de 2FA emitidos por login() y consumidos por completeMfaLogin().
-- expires_at en milisegundos desde epoch. TTL 5 min, maximo 5 fallos.
-- Ver packages/auth/src/ephemeral-auth-store.ts. Los stores D1/SQLite tambien
-- crean esta tabla al vuelo (mismo DDL) para bases anteriores a este cambio.

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_expires ON auth_mfa_challenges(expires_at);

-- Contadores de rate limit por ventana fija (window_start en ms desde epoch).
-- bucket guarda SHA-256 de la IP o del username, nunca el valor en claro.
-- Buckets SHA-256 de auth/action limits: reset, login, imágenes y plugins.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);

-- Challenges de step-up por email (codigo OTP de un solo uso, SHA-256 del
-- codigo, TTL 10 min, maximo 5 fallos). Base primitiva: los endpoints
-- todavia no la usan. Ver packages/auth/src/email-stepup-store.ts. Los
-- stores D1/SQLite tambien la crean al vuelo para bases anteriores.

CREATE TABLE IF NOT EXISTS auth_email_stepup_codes (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_email_stepup_expires ON auth_email_stepup_codes(expires_at);
