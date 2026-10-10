-- -----------------------------------------------------------------------------
-- v0.0.9.27 -- Configuracion dinamica de la GitHub App (registro via manifiesto)
-- -----------------------------------------------------------------------------
-- Identidad de la App (no tokens de usuario: esos van en deployment_credentials).
-- client_secret, pem y webhook_secret CIFRADOS con PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY.
-- webhook_secret_enc nullable: el webhook se registra con active=false hasta
-- que exista el receptor que valide X-Hub-Signature-256.

CREATE TABLE IF NOT EXISTS deployment_providers_config (
  provider_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_slug TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  webhook_secret_enc TEXT,
  html_url TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
