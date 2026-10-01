-- Activaciones de proveedores pay-per-crawl (PR H).
-- Fuente de referencia: la tabla la crea el propio store con IF NOT EXISTS al
-- primer uso (packages/trust-layer/src/billing/pay-per-crawl/activation-store.ts).
-- Incorporar al schema.sql maestro con scripts/generate-schema.mjs.
-- credential_enc: credencial CIFRADA con AES-GCM (PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS settlement_provider_activations (
  provider_id TEXT PRIMARY KEY,
  credential_enc TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT NOT NULL,
  activated_by TEXT NOT NULL
);
