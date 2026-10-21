-- Publication orchestration runs (C34).
--
-- One row per publish/retry/unpublish attempt. The row stores identifiers and
-- outcome metadata only: no content, no tokens, no provider responses.
CREATE TABLE IF NOT EXISTS publication_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  revision_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  commit_sha TEXT,
  pages_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_publication_runs_snapshot
  ON publication_runs(snapshot_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_publication_runs_status
  ON publication_runs(status, started_at DESC);
