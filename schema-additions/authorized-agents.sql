-- -----------------------------------------------------------------------------
-- v0.0.9.21 -- Allowlist de agentes autorizados a reportar sobre SiteTrustScore
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS authorized_agents (
  agent_key_id TEXT PRIMARY KEY,
  signature_agent_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519'
);

CREATE INDEX IF NOT EXISTS idx_authorized_agents_active ON authorized_agents(active);
