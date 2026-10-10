-- -----------------------------------------------------------------------------
-- v0.0.9.26 -- Tokens efimeros del Capability Bridge HTTP
-- -----------------------------------------------------------------------------
-- Reemplaza el secreto estatico PORTALESS_INTERNAL_BRIDGE_TOKEN -- ver
-- hallazgo de seguridad documentado en ROADMAP.md y
-- packages/plugin-sandbox/src/registry/stores/capability-token-store.ts.
-- Un token por EJECUCION de sandbox (no por invocacion de capacidad),
-- TTL corto (default 5 min via expires_at), scopeado a un plugin_name
-- especifico, con snapshot de granted_capabilities_json al momento de
-- emision (evita condiciones de carrera si un admin revoca un permiso a
-- mitad de una ejecucion en curso).

CREATE TABLE IF NOT EXISTS capability_bridge_tokens (
  token TEXT PRIMARY KEY,
  plugin_name TEXT NOT NULL,
  granted_capabilities_json TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capability_bridge_tokens_expires_at
  ON capability_bridge_tokens(expires_at);
