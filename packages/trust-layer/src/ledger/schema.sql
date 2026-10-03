-- ERRATA E-9: reader_did (DID APW candidato del lector, sin verificar).
-- Las bases existentes reciben la columna al vuelo desde los stores
-- (SQLite: ALTER al abrir; D1: ALTER en la primera operacion).
CREATE TABLE IF NOT EXISTS usage_ledger (
  period TEXT NOT NULL, operator_key_id TEXT NOT NULL, operator_name_claimed TEXT,
  requests_total INTEGER NOT NULL DEFAULT 0, requests_charged INTEGER NOT NULL DEFAULT 0,
  requests_free_tier INTEGER NOT NULL DEFAULT 0, revenue_usd REAL NOT NULL DEFAULT 0,
  policy_violations_detected INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  reader_did TEXT,
  PRIMARY KEY (period, operator_key_id));
