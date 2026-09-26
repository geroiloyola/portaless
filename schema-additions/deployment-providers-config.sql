-- v0.0.9.27: configuracion dinamica de la GitHub App registrada via manifiesto.
-- Agregar al schema.sql maestro (mismo precedente que deployment-oauth.sql).
-- Secretos CIFRADOS con PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY (formato v1.iv.ct).
-- webhook_secret_enc es nullable: el manifiesto registra el webhook con
-- active=false (el endpoint receptor no existe todavia) y GitHub puede no
-- devolver webhook_secret en ese caso.
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
