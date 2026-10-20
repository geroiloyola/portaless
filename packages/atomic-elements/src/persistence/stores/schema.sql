-- Esquema de persistencia real de paginas (Atomic Elements), server-side.
-- Espejo del patron usado en packages/permissions/src/stores/schema.sql y
-- packages/trust-layer/src/ledger/schema.sql.

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  publication_id TEXT,
  revision_id TEXT,
  revision_no INTEGER,
  content_hash TEXT
);

-- Append-only snapshots. Only revisions with approved_at are eligible for a
-- public projection; drafts and private work stay in the canonical database.
CREATE TABLE IF NOT EXISTS page_revisions (
  revision_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  parent_revision_id TEXT,
  content_hash TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  UNIQUE (publication_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_page_revisions_public_history
  ON page_revisions (publication_id, approved_at, revision_no);

CREATE TRIGGER IF NOT EXISTS page_revisions_no_update
  BEFORE UPDATE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END;
CREATE TRIGGER IF NOT EXISTS page_revisions_no_delete
  BEFORE DELETE ON page_revisions BEGIN SELECT RAISE(ABORT, 'page_revision_immutable'); END;

-- Evidence is attached to one exact revision; no site-level score is copied
-- here unless an input source explicitly names that revision.
CREATE TABLE IF NOT EXISTS page_revision_evidence (
  evidence_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  sample_size INTEGER,
  weight REAL,
  calculation_json TEXT NOT NULL,
  proof_json TEXT,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_revision_evidence_revision
  ON page_revision_evidence (revision_id, observed_at, evidence_id);
CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_update
  BEFORE UPDATE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END;
CREATE TRIGGER IF NOT EXISTS page_revision_evidence_no_delete
  BEFORE DELETE ON page_revision_evidence BEGIN SELECT RAISE(ABORT, 'page_revision_evidence_immutable'); END;
