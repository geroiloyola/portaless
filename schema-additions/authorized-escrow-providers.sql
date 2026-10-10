-- -----------------------------------------------------------------------------
-- v0.0.9.23 -- Allowlist de proveedores de escrow autorizados a reportar
-- -----------------------------------------------------------------------------
-- APW v1.2 (ERRATA E-4): public_key_jwk es la clave publica Ed25519 del
-- proveedor ({ kty, crv, x }). Verifica la atestacion JWS de sus reportes.
-- Sin ella, el proveedor queda autorizado pero no puede reportar.

CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
  provider_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  public_key_jwk TEXT
);

CREATE INDEX IF NOT EXISTS idx_authorized_escrow_providers_active ON authorized_escrow_providers(active);
