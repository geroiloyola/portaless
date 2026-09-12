CREATE TABLE IF NOT EXISTS usage_ledger (
  period TEXT NOT NULL, operator_key_id TEXT NOT NULL, operator_name_claimed TEXT,
  requests_total INTEGER NOT NULL DEFAULT 0, requests_charged INTEGER NOT NULL DEFAULT 0,
  requests_free_tier INTEGER NOT NULL DEFAULT 0, revenue_usd REAL NOT NULL DEFAULT 0,
  policy_violations_detected INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (period, operator_key_id));
