-- Esquema de persistencia real de paginas (Atomic Elements), server-side.
-- Espejo del patron usado en packages/permissions/src/stores/schema.sql y
-- packages/trust-layer/src/ledger/schema.sql.

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
