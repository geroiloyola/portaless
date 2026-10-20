-- v0.0.9.36 -- auditoría MCP durable, por invocación y append-only.
CREATE TABLE IF NOT EXISTS mcp_audit_events (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  agent_key_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  capability_id TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  subject_id TEXT,
  revision_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_events_timestamp
  ON mcp_audit_events(timestamp);

CREATE TRIGGER IF NOT EXISTS mcp_audit_events_no_update
  BEFORE UPDATE ON mcp_audit_events
  BEGIN SELECT RAISE(ABORT, 'mcp audit events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS mcp_audit_events_no_delete
  BEFORE DELETE ON mcp_audit_events
  BEGIN SELECT RAISE(ABORT, 'mcp audit events are append-only'); END;
