-- -----------------------------------------------------------------------------
-- v0.0.9.27 -- Motor de Despliegue: OAuth de infraestructura (GitHub App)
-- -----------------------------------------------------------------------------
-- deployment_oauth_states: state + code_verifier PKCE, un solo uso (se borra
-- al consumirse), TTL 10 min, atado al admin que inicio el flujo.
-- deployment_credentials: access/refresh token CIFRADOS con AES-GCM
-- (clave en env var PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY, nunca aqui).

CREATE TABLE IF NOT EXISTS deployment_oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployment_oauth_states_expires ON deployment_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS deployment_credentials (
  provider TEXT PRIMARY KEY,
  account_login TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at TEXT,
  refresh_expires_at TEXT,
  connected_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
