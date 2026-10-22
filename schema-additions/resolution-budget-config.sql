-- PR2 -- versioned owner configuration for the pre-auth resolution budget.
-- No default row is inserted: existing installations preserve their behavior.
-- Runtime secrets and counters never belong in this table.

CREATE TABLE IF NOT EXISTS resolution_budget_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
