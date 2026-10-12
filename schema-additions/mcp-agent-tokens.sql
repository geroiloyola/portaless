-- -----------------------------------------------------------------------------
-- v0.0.9.31 -- Tokens de agentes MCP (identidad por invocacion, Opcion B)
-- -----------------------------------------------------------------------------
-- Bearer tokens para el transporte HTTP del mcp-server (PORTALESS_MCP_
-- TRANSPORT=http). Solo se persiste el hash sha256 del token (mismo
-- patron que authorized_escrow_providers.api_key_hash); el plaintext se
-- devuelve UNA vez al emitirlo desde /admin/api/mcp-agents y no se
-- guarda. Rotacion: un solo token activo por agent_key_id -- emitir uno
-- nuevo revoca el anterior (UPDATE ... revoked = 1); revoke() corta por
-- agent. Ver packages/mcp-server/src/permissions/agent-token-store.ts.

CREATE TABLE IF NOT EXISTS mcp_agent_tokens (
  token_hash TEXT PRIMARY KEY,
  agent_key_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_tokens_agent_key_id
  ON mcp_agent_tokens(agent_key_id);
