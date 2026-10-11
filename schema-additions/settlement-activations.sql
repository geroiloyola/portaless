-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Activaciones de proveedores pay-per-crawl (PR H)
-- -----------------------------------------------------------------------------
-- credential_enc: credencial CIFRADA con AES-GCM (PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY).
-- La tabla la crea el propio store con IF NOT EXISTS al primer uso
-- (packages/trust-layer/src/billing/pay-per-crawl/activation-store.ts),
-- asi que las bases existentes la reciben al vuelo; desde v0.0.9.10 tambien
-- vive en el schema maestro y en REQUIRED_TABLES para instalaciones limpias.

CREATE TABLE IF NOT EXISTS settlement_provider_activations (
  provider_id TEXT PRIMARY KEY,
  credential_enc TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT NOT NULL,
  activated_by TEXT NOT NULL
);
