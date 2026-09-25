-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.27)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita el schema.sql del paquete correspondiente y
-- corre: node scripts/generate-schema.mjs
--
-- NOTA v0.0.9.24: la columna key_algorithm de authorized_agents (mas abajo)
-- se agrego directamente a este archivo maestro. CONFIRMADO: packages/
-- trust-layer/src/site-trust/ no tiene un schema.sql de paquete individual.
--
-- NOTA v0.0.9.25: se agrega site_identity (packages/apw-resolver/schema.sql,
-- fuente propia nueva) -- identidad did:apw del sitio mismo, generada por el
-- Wizard de onboarding (Paso 3-4). Ver packages/apw-resolver/src/did-apw/.
--
-- NOTA v0.0.9.26: se agrega capability_bridge_tokens -- tokens efimeros del
-- Capability Bridge HTTP (functions/api/internal/capability-bridge.js),
-- reemplazando el secreto estatico PORTALESS_INTERNAL_BRIDGE_TOKEN. Ver
-- packages/plugin-sandbox/src/registry/stores/capability-token-store.ts.
--
-- NOTA v0.0.9.27: se agregan deployment_oauth_states y deployment_credentials
-- (Motor de Despliegue, OAuth de infraestructura con GitHub App) directamente
-- a este archivo maestro, mismo precedente que v0.0.9.24. Fuente original:
-- schema-additions/deployment-oauth.sql (se conserva como referencia).
-- Ver packages/deploy-engine/src/oauth-store.ts.
--
-- Aplicar este archivo:
--   Cloudflare D1:      wrangler d1 execute <NOMBRE_DB> --file=schema.sql
--   SQLite self-hosted: sqlite3 portaless.db < schema.sql
--   O usa el instalador completo: npm run setup
--
-- Todas las sentencias son CREATE TABLE/INDEX IF NOT EXISTS -- correr este
-- archivo repetidas veces sobre una base de datos que ya tiene las tablas
-- es seguro y no destruye datos existentes.

-- -----------------------------------------------------------------------------
-- @portaless/auth -- usuarios y sesiones
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

-- -----------------------------------------------------------------------------
-- @portaless/permissions -- Centro de Permisos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS permission_grants (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_display_name TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  granted INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (subject_type, subject_id, capability_id)
);

CREATE INDEX IF NOT EXISTS idx_grants_capability ON permission_grants(capability_id);

-- -----------------------------------------------------------------------------
-- @portaless/trust-layer -- ledger de uso por agentes
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_ledger (
  period TEXT NOT NULL,
  operator_key_id TEXT NOT NULL,
  operator_name_claimed TEXT,
  requests_total INTEGER NOT NULL DEFAULT 0,
  requests_charged INTEGER NOT NULL DEFAULT 0,
  requests_free_tier INTEGER NOT NULL DEFAULT 0,
  revenue_usd REAL NOT NULL DEFAULT 0,
  policy_violations_detected INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (period, operator_key_id)
);

-- -----------------------------------------------------------------------------
-- @portaless/atomic-elements -- paginas persistidas
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- -----------------------------------------------------------------------------
-- v0.0.9.4 -- Recuperacion de contrasena
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_requests (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_username ON password_reset_requests(username);

-- -----------------------------------------------------------------------------
-- v0.0.9.9 -- Registro dinamico de plugins
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plugin_registry (
  plugin_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  author TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('open', 'closed')),
  manifest_json TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  installed_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  trust_score REAL NOT NULL DEFAULT 0,
  trust_score_votes INTEGER NOT NULL DEFAULT 0,
  audited_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_registry_active ON plugin_registry(active);

CREATE TABLE IF NOT EXISTS plugin_trust_votes (
  plugin_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  voted_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, voter_id)
);

-- -----------------------------------------------------------------------------
-- v0.0.9.19 -- Site Trust Score
-- -----------------------------------------------------------------------------

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
  PRIMARY KEY (site_id, category, agent_key_id, verified_at)
);

CREATE INDEX IF NOT EXISTS idx_site_trust_agent_site_category
  ON site_trust_agent_verifications(site_id, category);

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
  PRIMARY KEY (site_id, escrow_provider, reported_at)
);

CREATE INDEX IF NOT EXISTS idx_site_trust_escrow_site
  ON site_trust_escrow_reports(site_id);

-- -----------------------------------------------------------------------------
-- v0.0.9.21 -- Allowlist de agentes autorizados a reportar sobre SiteTrustScore
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS authorized_agents (
  agent_key_id TEXT PRIMARY KEY,
  signature_agent_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519'
);

CREATE INDEX IF NOT EXISTS idx_authorized_agents_active ON authorized_agents(active);

-- -----------------------------------------------------------------------------
-- v0.0.9.23 -- Allowlist de proveedores de escrow autorizados a reportar
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
  provider_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_authorized_escrow_providers_active ON authorized_escrow_providers(active);

-- -----------------------------------------------------------------------------
-- v0.0.9.25 -- Identidad did:apw del sitio (packages/apw-resolver/schema.sql)
-- -----------------------------------------------------------------------------
-- Identidad criptografica que ESTE sitio usa para firmarse a si mismo ante
-- terceros via Protocol APW (Wizard de onboarding, Paso 3-4). NO confundir
-- con authorized_agents (agentes EXTERNOS que Portaless autoriza a ACCEDER
-- a este sitio) ni con authorized_escrow_providers.
--
-- La clave privada NUNCA se persiste en texto plano: private_key_jwk_encrypted
-- guarda el JWK cifrado con AES-GCM. La clave de cifrado vive fuera de esta
-- base de datos (env var PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY).

CREATE TABLE IF NOT EXISTS site_identity (
  site_id TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  private_key_jwk_encrypted TEXT NOT NULL,
  private_key_encryption_iv TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

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

-- -----------------------------------------------------------------------------
-- v0.0.9.27 -- Motor de Despliegue: OAuth de infraestructura (GitHub App)
-- -----------------------------------------------------------------------------
-- deployment_oauth_states: state + code_verifier PKCE, un solo uso (se borra
-- al consumirse), TTL 10 min, atado al admin que inicio el flujo.
-- deployment_credentials: access/refresh token CIFRADOS con AES-GCM
-- (clave en env var PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY, nunca aqui).

CREATE TABLE IF NOT EXISTS deployment_oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployment_oauth_states_expires ON deployment_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS deployment_credentials (
  provider TEXT PRIMARY KEY,
  account_login TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at TEXT,
  refresh_expires_at TEXT,
  connected_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
