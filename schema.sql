-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.32)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita su fuente (packages/*/schema.sql o
-- schema-additions/*.sql -- ver la lista al inicio de generate-schema.mjs)
-- y corre: node scripts/generate-schema.mjs
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
-- a este archivo maestro, mismo precedente que v0.0.9.24. Fuente:
-- schema-additions/deployment-oauth.sql (hoy fuente directa del generador).
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
--     tienen schema.sql de paquete: se editan en schema-additions/*.sql
--     (desde v0.0.9.31; antes directamente aca).
--   - Las bases anteriores NO necesitan reaplicar este archivo: los stores
--     agregan estas columnas e indices solos (ALTER TABLE al primer uso).
--
-- NOTA v0.0.9.31 (fuentes):
--   - usage_ledger gana reader_did (ERRATA E-9). Ya estaba en
--     packages/trust-layer/src/ledger/schema.sql; el maestro estaba atrasado
--     respecto de su propia fuente.
--   - Tabla nueva reader_conduct_jti (spec APW 6.4): indice de los jti de
--     reader_conduct que el sitio ya emitio (jti determinista por emisor,
--     lector, periodo y categoria). DDL en packages/apw-resolver/schema.sql;
--     los stores D1/SQLite la crean al vuelo en bases existentes.
--   Ambas piezas solo completan instalaciones limpias: las bases anteriores
--   las reciben de sus stores al vuelo, sin reaplicar este archivo.
--
-- NOTA v0.0.9.31 (estructura): las secciones sin schema.sql de paquete
-- (password reset, plugins, site_trust_*, authorized_*, capability bridge,
-- settlement activations, deployment) viven ahora en schema-additions/*.sql
-- como fuentes directas del generador. settlement_provider_activations se
-- incorporo al maestro y a REQUIRED_TABLES en v0.0.9.10 (antes solo la
-- creaba su store al vuelo; ver ROADMAP.md).
--
-- NOTA Portaless Index (APW 5.7, seccion 7): witness_observations,
-- witness_weights y witness_index_subjects -- agregador de testigos
-- (observaciones verificadas por sujeto, ponderacion estatica por testigo y
-- entrada de directorio cacheada que publica /.well-known/apw-index.json).
-- DDL en packages/apw-resolver/schema.sql; los stores D1/SQLite las crean
-- al vuelo en bases existentes.
--
-- NOTA v0.0.9.32: tabla nueva site_atproto_links -- vinculos opcionales
-- APW <-> AT Protocol (handles que el sitio reclama en su did:apw via
-- alsoKnownAs). Fuente schema-additions/atproto-links.sql; el store la
-- crea al vuelo en bases existentes. Sin filas el did.json no cambia.
--
-- NOTA v0.0.9.33: tabla nueva site_settings -- ajustes generales del sitio
-- en clave/valor (primer uso: configuracion de analytics que /admin/analytics
-- escribe y /api/analytics emite al publico). Fuente
-- schema-additions/site-settings.sql; el store la crea al vuelo en bases
-- existentes. Ver packages/dashboard/src/site-settings/site-settings-store.ts.
--
-- NOTA v0.0.9.34: tabla nueva activity_events -- feed de actividad del
-- dashboard (Fase 10). Append-only, admin-only, sin IPs; reemplaza los
-- paneles mock que mostraban datos falsos. Fuente
-- schema-additions/activity-events.sql; el store la crea al vuelo en bases
-- existentes. Ver packages/dashboard/src/activity/activity-store.ts.
--
-- NOTA v0.0.9.35: tablas nuevas plugin_artifacts y plugin_artifact_chunks --
-- codigo de plugins instalados por HTTP, troceado en BLOB de 512 KB (limites
-- de D1). Fuente schema-additions/plugin-artifacts.sql; el store las crea al
-- vuelo. Ver packages/plugin-sandbox/src/registry/plugin-artifacts.ts.
--
-- NOTA PR2: resolution_budget_config guarda configuración tipada versionada,
-- nunca secretos ni contadores. Sin fila, instalaciones previas no cambian.
-- Fuente schema-additions/resolution-budget-config.sql; migración versionada v10.
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

-- Esquema de persistencia real para @portaless/auth.
-- Aplica esto vía Cloudflare D1 (wrangler d1 execute --file=schema.sql)
-- o contra un archivo SQLite local para despliegues self-hosted.

-- v0.0.9.10: columnas de email, 2FA (TOTP) y OAuth -- antes solo existian
-- en InMemoryUsersStore; los stores reales (SQLite/D1) las agregan solas
-- con ALTER TABLE en bases viejas (mismo patron que site_identity_keys).
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email TEXT,
  provider TEXT,
  totp_secret TEXT,
  totp_enabled_at TEXT,
  oauth_provider TEXT,
  oauth_subject TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mfa_verified INTEGER NOT NULL DEFAULT 0
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
-- Buckets SHA-256 de auth/action limits: reset, login, imágenes y plugins.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);

-- Challenges de step-up por email (codigo OTP de un solo uso, SHA-256 del
-- codigo, TTL 10 min, maximo 5 fallos). Base primitiva: los endpoints
-- todavia no la usan. Ver packages/auth/src/email-stepup-store.ts. Los
-- stores D1/SQLite tambien la crean al vuelo para bases anteriores.

CREATE TABLE IF NOT EXISTS auth_email_stepup_codes (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_email_stepup_expires ON auth_email_stepup_codes(expires_at);

-- -----------------------------------------------------------------------------
-- @portaless/permissions -- Centro de Permisos
-- -----------------------------------------------------------------------------

-- Esquema de persistencia real para @portaless/permissions.
-- Aplicar via Cloudflare D1 (wrangler d1 execute --file=schema.sql)
-- o contra un archivo SQLite local para despliegues self-hosted.

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

-- ERRATA E-9: reader_did (DID APW candidato del lector, sin verificar).
-- Las bases existentes reciben la columna al vuelo desde los stores
-- (SQLite: ALTER al abrir; D1: ALTER en la primera operacion).
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
  reader_did TEXT,
  PRIMARY KEY (period, operator_key_id)
);

-- -----------------------------------------------------------------------------
-- @portaless/atomic-elements -- paginas persistidas
-- -----------------------------------------------------------------------------

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

-- Approval is a separate immutable act; a revision snapshot is never edited
-- when it is approved. v7 migration backfills pre-existing approved rows.
CREATE TABLE IF NOT EXISTS page_revision_approvals (
  revision_id TEXT PRIMARY KEY,
  approved_at TEXT NOT NULL,
  approved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_page_revision_approvals_approved_at
  ON page_revision_approvals (approved_at, revision_id);
CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_update
  BEFORE UPDATE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END;
CREATE TRIGGER IF NOT EXISTS page_revision_approvals_no_delete
  BEFORE DELETE ON page_revision_approvals BEGIN SELECT RAISE(ABORT, 'page_revision_approval_immutable'); END;
INSERT OR IGNORE INTO page_revision_approvals (revision_id, approved_at, approved_by)
  SELECT revision_id, approved_at, approved_by FROM page_revisions WHERE approved_at IS NOT NULL;

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
-- v0.0.9.30 -- Historial de cambios de contrasena (admin)
-- -----------------------------------------------------------------------------
-- Auditoria interna de cambios/resets de contrasena: cuando, desde que IP,
-- user agent recortado y ubicacion aproximada (solo la que aporta Cloudflare).
-- Nunca guarda la contrasena ni su hash. La tabla tambien se crea al vuelo en
-- el store para bases existentes; esta fuente mantiene la paridad de una
-- instalacion limpia y del schema maestro.

CREATE TABLE IF NOT EXISTS password_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  country TEXT,
  city TEXT
);

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

-- -----------------------------------------------------------------------------
-- v1.2 -- Politica de lectura del sitio (LTP 6.5 / ERRATA E-8)
-- -----------------------------------------------------------------------------
-- Configuracion global por sitio (no un grant). Sin fila o enabled=0 la lectura
-- es publica. public_overrides solo puede abrir dimensiones gobernadas; el
-- nivel publico nunca se oculta. El store tambien crea la tabla al vuelo para
-- bases existentes; esta fuente mantiene la paridad de una instalacion limpia.

CREATE TABLE IF NOT EXISTS site_trust_read_policies (
  site_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  require_apw_identity INTEGER NOT NULL DEFAULT 1 CHECK (require_apw_identity = 1),
  min_r01 REAL NOT NULL DEFAULT 5.0 CHECK (min_r01 >= 1 AND min_r01 <= 7),
  min_r01_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r01_weight >= 0),
  min_r05 REAL NOT NULL DEFAULT 5.0 CHECK (min_r05 >= 1 AND min_r05 <= 7),
  min_r05_weight REAL NOT NULL DEFAULT 2.0 CHECK (min_r05_weight >= 0),
  on_fail TEXT NOT NULL DEFAULT '403' CHECK (on_fail IN ('401', '402', '403')),
  public_overrides TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

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
-- @portaless/apw-resolver -- identidad did:apw e historial encadenado
-- -----------------------------------------------------------------------------

-- packages/apw-resolver/schema.sql
--
-- Fuente de verdad de site_identity -- ver packages/apw-resolver/src/did-apw/
-- site-identity-store.ts para la logica de cifrado/descifrado.
--
-- Identidad criptografica que ESTE sitio usa para firmarse a si mismo ante
-- terceros via Protocol APW (Wizard de onboarding, Paso 3-4). NO confundir
-- con authorized_agents (agentes EXTERNOS que Portaless autoriza a ACCEDER
-- a este sitio) ni con authorized_escrow_providers.
--
-- La clave privada NUNCA se persiste en texto plano: private_key_jwk_encrypted
-- guarda el JWK cifrado con AES-GCM. La clave de cifrado vive fuera de esta
-- base de datos (env var PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY).
--
-- Este archivo se concatena al maestro via scripts/generate-schema.mjs.
-- No aplicar directamente contra una base de datos en produccion -- usar
-- siempre el schema.sql maestro o node scripts/setup.mjs.

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

-- Reputacion del lector (spec APW 6.4, ERRATA E-9): indice local de los jti
-- de reader_conduct que este sitio ya emitio, para no repetir una emision
-- del mismo periodo (jti determinista por emisor, lector, periodo y cat).
-- La fuente historica sigue siendo att_jws del historial encadenado (E-9):
-- en bases migradas el indice se siembra desde ahi (collectEmittedJtis) y
-- los stores D1/SQLite crean esta tabla al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS reader_conduct_jti (
  site_id TEXT NOT NULL,
  jti TEXT NOT NULL,
  period TEXT NOT NULL,
  cat TEXT NOT NULL,
  reader_did TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (site_id, jti)
);

-- Portaless Index, agregador de testigos (APW v1.3, 5.7 y seccion 7):
-- observaciones VERIFICADAS recopiladas de los testigos configurados por
-- sujeto (la ultima observacion anclada de cada testigo por seq, con su
-- fecha creible = ts de la entrada del historial DEL TESTIGO), la
-- ponderacion BASE por testigo (default 1.0) + la calibracion estilo
-- A.4.4 (contadores acuerdo/desacuerdo con el consenso), la ultima
-- entrada de directorio cacheada (publica /.well-known/apw-index.json
-- sin re-bajar cadenas por request) y los pares nodo-indice configurados
-- para la sincronizacion entre nodos (syncIndexPeers). Los stores
-- D1/SQLite crean estas tablas al vuelo (mismo DDL).

CREATE TABLE IF NOT EXISTS witness_observations (
  site_id TEXT NOT NULL,
  subject_did TEXT NOT NULL,
  witness_did TEXT NOT NULL,
  observed_seq INTEGER NOT NULL,
  observed_head TEXT,
  anchored_ts TEXT NOT NULL,
  statement_jti TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, subject_did, witness_did, observed_seq)
);

CREATE TABLE IF NOT EXISTS witness_weights (
  site_id TEXT NOT NULL,
  witness_did TEXT NOT NULL,
  weight REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, witness_did)
);

CREATE TABLE IF NOT EXISTS witness_calibration (
  site_id TEXT NOT NULL,
  witness_did TEXT NOT NULL,
  agree INTEGER NOT NULL DEFAULT 0,
  disagree INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, witness_did)
);

CREATE TABLE IF NOT EXISTS witness_index_subjects (
  site_id TEXT NOT NULL,
  subject_did TEXT NOT NULL,
  domain TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, subject_did)
);

CREATE TABLE IF NOT EXISTS witness_index_peers (
  site_id TEXT NOT NULL,
  peer_domain TEXT NOT NULL,
  peer_did TEXT,
  added_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never_synced',
  last_subjects_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, peer_domain)
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
-- v0.0.9.31 -- Nonces anti-replay de Web Bot Auth compartidos entre instancias
-- -----------------------------------------------------------------------------
-- Reemplaza al Map en memoria por proceso que usaba webbotauth/verify.ts:
-- con multiples workers cada proceso tenia su propia ventana de 300 s y un
-- replay del mismo nonce contra otra instancia pasaba. Patron identico a
-- auth_mfa_challenges (packages/auth): nonce como PRIMARY KEY, el INSERT
-- atomico con UNIQUE es la deteccion de replay, y expires_at (epoch ms)
-- con DELETE de vencidos en cada escritura da el TTL. Ver
-- packages/trust-layer/src/webbotauth/nonce-store.ts.

CREATE TABLE IF NOT EXISTS webbotauth_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webbotauth_nonces_expires_at
  ON webbotauth_nonces(expires_at);

-- -----------------------------------------------------------------------------
-- v0.0.9.31 -- Tokens de agentes MCP (identidad por invocacion, Opcion B)
-- -----------------------------------------------------------------------------
-- Bearer tokens para el transporte HTTP del mcp-server (PORTALESS_MCP_
-- TRANSPORT=http). Solo se persiste el hash sha256 del token (mismo
-- patron que authorized_escrow_providers.api_key_hash); el plaintext se
-- devuelve UNA vez al emitirlo desde /admin/api/mcp-agents y no se
-- guarda. Rotacion: un solo token activo por agent_key_id -- emitir uno
-- nuevo revoca el anterior (UPDATE ... revoked = 1); revoke() corta por
-- agent. Ver packages/mcp-server/src/permissions/agent-token-store.ts.

CREATE TABLE IF NOT EXISTS mcp_agent_tokens (
  token_hash TEXT PRIMARY KEY,
  agent_key_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_tokens_agent_key_id
  ON mcp_agent_tokens(agent_key_id);

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

-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Activaciones de proveedores pay-per-crawl (PR H)
-- -----------------------------------------------------------------------------
-- credential_enc: credencial CIFRADA con AES-GCM (PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY).
-- La tabla la crea el propio store con IF NOT EXISTS al primer uso
-- (packages/trust-layer/src/billing/pay-per-crawl/activation-store.ts),
-- asi que las bases existentes la reciben al vuelo; desde v0.0.9.10 tambien
-- vive en el schema maestro y en REQUIRED_TABLES para instalaciones limpias.

CREATE TABLE IF NOT EXISTS settlement_provider_activations (
  provider_id TEXT PRIMARY KEY,
  credential_enc TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT NOT NULL,
  activated_by TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- v0.0.9.32 -- Vinculos opcionales APW <-> AT Protocol (alsoKnownAs)
-- -----------------------------------------------------------------------------
-- Handles AT que el sitio reclama en su propio documento did:apw
-- (campo estandar W3C `alsoKnownAs`, el mismo que lee el ecosistema AT
-- Protocol). Publicados en /.well-known/did.json.js; gestionados desde
-- /admin/api/apw-atproto-links. Sin filas = sin campo = documento
-- identico al de antes (el puente es 100% opcional). El lado de
-- resolucion/join vive en packages/identity-atproto/. Ver
-- docs/architecture/identity-atproto.md.

CREATE TABLE IF NOT EXISTS site_atproto_links (
  site_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (site_id, handle)
);

-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Cloud Images + APW como SSOT criptografico
-- -----------------------------------------------------------------------------
-- Registro de imagenes publicadas por el sitio: metadata firmada (sidecar
-- JWS Ed25519 typ apw-image+jws, ver packages/cloud-images/src/sign.ts) +
-- bytes de la imagen en una sola fila. content_hash es UNICO: subir la
-- misma imagen otra vez devuelve la existente (dedupe). El desacople de
-- bytes a R2 queda como item externo del ROADMAP: moverlos = migrar la
-- columna a un bucket con la misma interface de bytes, sin tocar formato
-- ni endpoints. Ver docs/architecture/cloud-images.md.

CREATE TABLE IF NOT EXISTS cloud_images (
  image_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  declared_origin TEXT NOT NULL,
  site_id TEXT NOT NULL,
  site_did TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'ed25519',
  signed_at TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_images_content_hash ON cloud_images (content_hash);

-- -----------------------------------------------------------------------------
-- Phase 0 -- visual identity foundation: skin activo del sitio
-- -----------------------------------------------------------------------------
-- Una fila por site (hoy solo "default"): nombre del skin ("base" |
-- "blog" | "tienda" | "trust-crm", ver packages/dashboard/src/skins/) +
-- los overrides de DesignTokens que el admin cambio desde
-- /admin/appearance (JSON con las MISMAS claves que DesignTokens:
-- accent, accentText, bg, ...). El sitio publico y el dashboard leen lo
-- mismo via GET /api/site-skin (hoja CSS que emite los tokens en :root);
-- no hay un segundo sistema de color. tokens_json vacio ("{}") = skin
-- sin overrides, sus valores resueltos via resolveSkin(). Ver
-- packages/dashboard/src/skin-engine/site-skin-store.ts.

CREATE TABLE IF NOT EXISTS site_skin (
  site_id TEXT PRIMARY KEY,
  skin TEXT NOT NULL,
  tokens_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- Phase 6 -- publication maturity: ajustes generales del sitio
-- -----------------------------------------------------------------------------
-- Clave/valor de un solo sitio (hoy "no hay sitio": Portaless corre una
-- instancia por sitio). Primer uso: la configuracion de analytics que
-- /admin/analytics escribe y que el sitio publico lee en /api/analytics.
-- Valores SIEMPRE texto (la capa tipada valida antes de persistir: ver
-- sanitizeAnalyticsInput en site-settings-store.ts).
--
-- No existe un settings generico hasta ahora: site_skin guarda tokens de
-- color y el nombre/resumen del sitio eran solo variables de entorno.

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- v0.0.9.11 -- catalogo extensible de elementos (element packs)
-- -----------------------------------------------------------------------------
-- La capa ABIERTA del catalogo de Atomic Elements: un plugin puede contribuir
-- sus propios elementos (schema + template, nunca una funcion de render) para
-- que el editor y un agente MCP los vean y usen, sin que el nucleo cambie.
-- El pack se guarda como JSON; la validacion pura vive en
-- packages/atomic-elements/src/elements/element-pack.ts y se aplica al
-- guardar y al cargar. Un pack invalido se ignora al cargar (no tira abajo el
-- catalogo entero). Ver docs/architecture/element-catalog-plugins.md.
--
-- Los elementos contribuidos son DATA-ONLY: render.kind = "html-template" que
-- el host interpola y escapa. El pack NO entrega una funcion de render -- la
-- frontera es el precedente de ProductGrid (host guarda la funcion, plugin
-- provee datos). "requiresEdgeEval" marca contenido que en modo "static" se
-- renderiza como placeholder y solo se resuelve a request time en el borde.

CREATE TABLE IF NOT EXISTS element_packs (
  name TEXT PRIMARY KEY,
  pack_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- v0.0.9.11 -- theme packs: look por pagina (modelo linktree)
-- -----------------------------------------------------------------------------
-- La capa ABIERTA del theming por pagina: un pack instalado (marketplace,
-- futuro slice) aporta SOLO variables CSS de la allowlist -- nunca CSS
-- libre ni una funcion. El pack se guarda como JSON; la validacion pura
-- vive en packages/atomic-elements/src/themes/theme-pack.ts y se aplica al
-- guardar y al cargar. Un pack invalido se ignora al cargar (no tira abajo
-- el catalogo entero). Los packs BUILTIN no se siembran aqui: viven en el
-- codigo (BUILTIN_THEMES) y availableThemes() los fusiona con esta tabla.
-- Ver docs/design/design-guide.md.

CREATE TABLE IF NOT EXISTS theme_packs (
  name TEXT PRIMARY KEY,
  pack_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- v0.0.9.10 -- Community attestations (APW v1.3, ERRATA E-13)
-- -----------------------------------------------------------------------------
-- Anexo append-only de las atestaciones comunitarias firmadas por un Veracier
-- (did:apw). Es la fuente que PUNTUA. La tabla site_trust_community_votes sigue
-- existiendo como opinion de visitante, visible y fuera del scoring: no tiene
-- identidad verificable y por eso no entra a ninguna dimension.
--
-- La clave primaria es (iss, jti): 5.3 exige jti unico POR EMISOR, no global,
-- y una fila nunca pisa a otra. El scoring toma la ultima por (iss, sub, cat)
-- en tiempo de lectura (E-13), asi que reemitir agrega, no sobreescribe.
--
-- emitter_first_seen_iat es el ts de la primera entrada verificada del
-- historial del emisor (5.4), capturado al recibir la atestacion. Es NULL si no
-- se pudo resolver; en ese caso el emisor NO acredita antiguedad (fail-closed,
-- E-13) y su atestacion se registra igual para que quede como dato publico.

CREATE TABLE IF NOT EXISTS community_attestations (
  iss TEXT NOT NULL,
  jti TEXT NOT NULL,
  site_id TEXT NOT NULL,
  sub TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'perceived_trustworthiness', 'content_accuracy', 'spam_or_deceptive', 'responsiveness'
  )),
  val INTEGER NOT NULL CHECK (val BETWEEN 1 AND 5),
  iat INTEGER NOT NULL,
  jws TEXT NOT NULL,
  emitter_first_seen_iat INTEGER,
  received_at TEXT NOT NULL,
  PRIMARY KEY (iss, jti)
);

CREATE INDEX IF NOT EXISTS idx_community_attestations_subject
  ON community_attestations(site_id, category);

CREATE INDEX IF NOT EXISTS idx_community_attestations_emitter
  ON community_attestations(iss, iat);

-- -----------------------------------------------------------------------------
-- v0.0.9.34 -- Fase 10: feed de actividad (admin)
-- -----------------------------------------------------------------------------
-- Append-only con lo que pasa en el dashboard y el runtime: paginas
-- guardadas/borradas, atestaciones comunitarias recibidas y cambios de
-- permisos. Reemplaza honestamente a los paneles mock (traffic, ledger,
-- orders, revenue) que mostraban datos falsos -- ver ROADMAP.md, Fase 10.
--
-- ADMIN-ONLY POR DISENO: alimenta /admin/api/recents (sesion /admin/*). No
-- guarda IPs, hashes de IP ni user agents: eso es auditoria interna en
-- password_change_events, con otra superficie. Un feed publico seria OTRA
-- tabla, no un filtro de esta.
--
-- SIN BACKFILL: arranca vacio; solo registra lo que ocurre tras el deploy.
-- Un unico escritor (emitActivity en activity-store.ts) inserta filas -- no
-- hay triggers ni copias desde tablas existentes, para que la tabla nunca
-- diverja de sus fuentes.

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  actor TEXT,
  subject TEXT NOT NULL,
  detail TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_occurred
  ON activity_events(occurred_at DESC, id DESC);

-- -----------------------------------------------------------------------------
-- v0.0.9.35 -- Fase 11.2: artefactos de plugins instalados (codigo, troceado)
-- -----------------------------------------------------------------------------
-- Guarda el CODIGO de un plugin instalado por HTTP para que el runtime lo
-- ejecute sin filesystem (workerd no tiene). Troceado por limites de D1:
-- ~2 MB por fila/BLOB, ~100 KB por sentencia -> chunks de 512 KB.
--
-- data es BLOB (Uint8Array), NUNCA base64 (infla 33%). El tope por artefacto
-- (MAX_ARTIFACT_BYTES, 4 MiB) y el tamano de chunk viven en
-- packages/plugin-sandbox/src/registry/plugin-artifacts.ts.
--
-- code_hash permite que reinstalar la MISMA (publisher, name, version) con
-- bytes distintos falle: si no, el hash guardado no protege nada.
--
-- §14.1: manifest_json viaja con el artefacto para que POST /admin/api/plugins/run
-- pueda ejecutarlo desde la base sin depender del filesystem (cierra el 503 de
-- workerd). En bases creadas antes de §14.1 el store agrega la columna con
-- ALTER TABLE al abrirse.

CREATE TABLE IF NOT EXISTS plugin_artifacts (
  publisher TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  manifest_json TEXT,
  PRIMARY KEY (publisher, name, version)
);

CREATE TABLE IF NOT EXISTS plugin_artifact_chunks (
  publisher TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (publisher, name, version, seq)
);

-- -----------------------------------------------------------------------------
-- v0.0.9.33 -- Override del operador sobre la politica de acceso de agentes
-- (ROADMAP.md, fase 12: "la politica de acceso de agentes pasa a ser operable
-- desde el panel", §12.1 + §12.2).
--
-- Una sola fila (id = 1). La precedencia documentada es store > asset >
-- default: si esta tabla esta vacia, la politica efectiva sale del asset
-- /.well-known/portaless-content-policy.json; si ese archivo no existe o esta
-- incompleto, de defaultContentPolicy() en manifest-schema.ts.
--
-- policy_json guarda el bloque "policies" completo y no una fila por regla, a
-- proposito: el manifiesto ya tiene esa forma, y una regla nueva agregada al
-- esquema (p. ej. una que no sea search/ai_input/ai_train) no requiere
-- migracion ni columna nueva.
--
-- Se valida al ESCRIBIR (nadie guarda un manifiesto a medio escribir) y se
-- revalida al LEER: un JSON corrupto o editado a mano cae al asset en vez de
-- dejar el sitio sin politica -- el fallo va hacia el valor conocido, nunca
-- hacia "sin regla".
--
-- No va en REQUIRED_TABLES (scripts/setup.mjs) a proposito: su ausencia es un
-- estado valido (el site usa el asset), igual que authorized_agents y
-- site_trust_read_policies.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_access_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- v0.0.9.36 -- Fase 14.2: storage por plugin (storage:read / storage:write)
-- -----------------------------------------------------------------------------
-- Almacen clave-valor por plugin: el primer backend de capacidad real de la
-- Fase 14. Las claves viven namespaced por plugin_id (clave primaria compuesta
-- (plugin_id, key)): un plugin solo puede tocar su propio espacio, y el
-- plugin_id lo fija el SERVIDOR (viene del token de ejecucion), nunca el body
-- del plugin.
--
-- Las cuotas (tamano de valor, cantidad de claves, bytes totales por plugin)
-- viven en packages/plugin-sandbox/src/registry/plugin-storage.ts, no en el
-- DDL: el store las aplica al escribir y responde con un codigo de error
-- explicito (STORAGE_VALUE_TOO_LARGE / STORAGE_TOO_MANY_KEYS /
-- STORAGE_QUOTA_EXCEEDED) en vez de fallar en silencio.

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin ON plugin_storage(plugin_id);

-- -----------------------------------------------------------------------------
-- v0.0.10 -- TASK 5: cuota diaria de email por plugin (email:send)
-- -----------------------------------------------------------------------------
-- Contador (plugin_id, dia UTC) para la capacidad email:send. El backend
-- (packages/plugin-sandbox/src/capabilities/capability-backends.ts) incrementa
-- con un UPDATE condicional ATOMICO: si el conteo ya llego al tope diario, la
-- fila no cambia y el plugin recibe EMAIL_QUOTA_EXCEEDED. El plugin_id lo fija
-- el SERVIDOR (token de ejecucion / manifiesto), nunca el body del plugin.

CREATE TABLE IF NOT EXISTS plugin_email_quota (
  plugin_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plugin_id, day)
);

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
