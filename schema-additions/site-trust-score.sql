-- -----------------------------------------------------------------------------
-- v0.0.9.19 -- Site Trust Score
-- -----------------------------------------------------------------------------
-- APW v1.2 (ERRATA E-4): agent y escrow_report guardan el JWS de la atestacion
-- firmada por el emisor (attestation_jws) y su jti, unico por emisor. Filas
-- anteriores quedan con attestation_jws NULL (no verificables por terceros).

CREATE TABLE IF NOT EXISTS site_trust_subjects (
  site_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_trust_self_evaluations (
  site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
  category TEXT NOT NULL CHECK (category IN (
    'gdpr_compliance', 'privacy_policy', 'terms_of_service',
    'payment_security', 'data_practices', 'contact_transparency'
  )),
  declared_value INTEGER NOT NULL CHECK (declared_value IN (0, 1)),
  evidence_url TEXT,
  declared_by TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  attestation_jws TEXT,
  attestation_jti TEXT,
  PRIMARY KEY (site_id, category)
);

CREATE TABLE IF NOT EXISTS site_trust_agent_verifications (
  site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
  category TEXT NOT NULL CHECK (category IN (
    'https_and_headers', 'structured_data_quality', 'machine_readable_policies',
    'content_freshness', 'bot_traffic_anomalies'
  )),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  detail_json TEXT,
  agent_key_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  attestation_jws TEXT,
  attestation_jti TEXT,
  PRIMARY KEY (site_id, category, agent_key_id, verified_at)
);

CREATE INDEX IF NOT EXISTS idx_site_trust_agent_site_category
  ON site_trust_agent_verifications(site_id, category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_trust_agent_jti
  ON site_trust_agent_verifications(agent_key_id, attestation_jti) WHERE attestation_jti IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_trust_community_votes (
  site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
  category TEXT NOT NULL CHECK (category IN (
    'perceived_trustworthiness', 'content_accuracy',
    'spam_or_deceptive', 'responsiveness'
  )),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  voter_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  voted_at TEXT NOT NULL,
  PRIMARY KEY (site_id, category, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_site_trust_community_site_category
  ON site_trust_community_votes(site_id, category);

CREATE INDEX IF NOT EXISTS idx_site_trust_community_rate_limit
  ON site_trust_community_votes(site_id, category, ip_hash, voted_at);

CREATE TABLE IF NOT EXISTS site_trust_escrow_reports (
  site_id TEXT NOT NULL REFERENCES site_trust_subjects(site_id),
  transaction_outcome TEXT NOT NULL CHECK (transaction_outcome IN (
    'completed_as_promised', 'refunded_no_delivery', 'disputed'
  )),
  escrow_provider TEXT NOT NULL,
  amount_currency TEXT,
  reported_at TEXT NOT NULL,
  attestation_jws TEXT,
  attestation_jti TEXT,
  PRIMARY KEY (site_id, escrow_provider, reported_at)
);

CREATE INDEX IF NOT EXISTS idx_site_trust_escrow_site
  ON site_trust_escrow_reports(site_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_trust_escrow_jti
  ON site_trust_escrow_reports(escrow_provider, attestation_jti) WHERE attestation_jti IS NOT NULL;
