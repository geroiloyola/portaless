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
-- Tambien deployment_providers_config (GitHub App registrada via manifiesto,
-- secretos cifrados). Fuente: schema-additions/deployment-providers-config.sql.
-- Ver packages/deploy-engine/src/providers-config-store.ts.
--
-- NOTA PR #62: se agregan auth_mfa_challenges y auth_rate_limits a la seccion
-- @portaless/auth. Fuente: packages/auth/src/stores/schema.sql (editado ahi y
-- copiado aca en la misma posicion que produce generate-schema.mjs).
--
-- NOTA APW v1.2 (PRs #71, #73, #74):
--   - La seccion de apw-resolver (site_identity, site_identity_keys,
--     site_attestation_log) es copia de packages/apw-resolver/schema.sql.
--   - site_trust_agent_verifications y site_trust_escrow_reports agregan
--     attestation_jws / attestation_jti y un indice unico por emisor (ERRATA
--     E-4). authorized_escrow_providers agrega public_key_jwk. Estas tablas no
--     tienen schema.sql de paquete: se editan aca, mismo precedente que v0.0.9.24.
--   - Las bases anteriores NO necesitan reaplicar este archivo: los stores
--     agregan estas columnas e indices solos (ALTER TABLE al primer uso).
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

-- Challenges de 2FA emitidos por login() y consumidos por completeMfaLogin().
-- expires_at en milisegundos desde epoch. TTL 5 min, maximo 5 fallos.
-- Ver packages/auth/src/ephemeral-auth-store.ts. Los stores D1/SQLite tambien
-- crean esta tabla al vuelo (mismo DDL) para bases anteriores a este cambio.

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_expires ON auth_mfa_challenges(expires_at);

-- Contadores de rate limit por ventana fija (window_start en ms desde epoch).
-- bucket guarda SHA-256 de la IP o del username, nunca el valor en claro.
-- Usado por /admin/password-reset/request (5 por IP, 3 por usuario, por hora).

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);

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
-- APW v1.2 (ERRATA E-4): public_key_jwk es la clave publica Ed25519 del
-- proveedor ({ kty, crv, x }). Verifica la atestacion JWS de sus reportes.
-- Sin ella, el proveedor queda autorizado pero no puede reportar.

CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
  provider_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  public_key_jwk TEXT
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

-- APW v1.2, seccion 5.4: historial de claves del sitio. site_identity guarda
-- la clave ACTUAL; aca queda cada clave que el sitio tuvo, con su ventana
-- valid_from / valid_to, para verificar entradas viejas del historial
-- encadenado despues de rotar. kid = huella RFC 7638 de la clave publica.
-- La privada solo existe en la clave activa: al rotar se pone en NULL.
-- El indice parcial impide dos claves activas a la vez por sitio.
--
-- ERRATA E-3: key_id = did:apw:<dominio>#key-<n> (el `kid` de los JWS que firma
-- el sitio) y key_sequence = <n>, unico por sitio. Las bases creadas por el
-- PR #71 no tienen estas columnas: el store las agrega solo (ALTER TABLE) y
-- asigna #key-1, #key-2... por fecha de alta.
-- Los stores tambien crean estas tablas al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS site_identity_keys (
  kid TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  public_key_jwk TEXT NOT NULL,
  private_key_encrypted TEXT,
  private_key_encryption_iv TEXT,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  key_id TEXT,
  key_sequence INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_active
  ON site_identity_keys(site_id) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_identity_keys_site
  ON site_identity_keys(site_id, valid_from);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_identity_keys_seq
  ON site_identity_keys(site_id, key_sequence);

-- APW v1.2, seccion 5.4: historial encadenado. Una fila por entrada; entry_jws
-- es la fuente de verdad (los verificadores recalculan hashes y firmas).
-- PK (site_id, seq): dos escrituras simultaneas no pueden bifurcar la cadena.
-- Indice unico (site_id, att_hash): la misma atestacion no se registra dos veces.
-- kid = huella RFC 7638 de la clave que firmo la entrada.

CREATE TABLE IF NOT EXISTS site_attestation_log (
  site_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_jws TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  prev_hash TEXT,
  att_hash TEXT NOT NULL,
  kid TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (site_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_attestation_log_att
  ON site_attestation_log(site_id, att_hash);

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

-- -----------------------------------------------------------------------------
-- v0.0.9.27 -- Configuracion dinamica de la GitHub App (registro via manifiesto)
-- -----------------------------------------------------------------------------
-- Identidad de la App (no tokens de usuario: esos van en deployment_credentials).
-- client_secret, pem y webhook_secret CIFRADOS con PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY.
-- webhook_secret_enc nullable: el webhook se registra con active=false hasta
-- que exista el receptor que valide X-Hub-Signature-256.

CREATE TABLE IF NOT EXISTS deployment_providers_config (
  provider_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_slug TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  webhook_secret_enc TEXT,
  html_url TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
