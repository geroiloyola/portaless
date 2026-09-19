-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.24)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita el schema.sql del paquete correspondiente y
-- corre: node scripts/generate-schema.mjs
--
-- NOTA v0.0.9.24: la columna key_algorithm de authorized_agents (mas abajo)
-- se agrego directamente a este archivo maestro. CONFIRMADO: packages/
-- trust-layer/src/site-trust/ no tiene un schema.sql de paquete individual
-- (solo contiene los .ts de stores/logica) -- a diferencia de auth,
-- permissions, ledger y atomic-elements (que si tienen su schema.sql fuente
-- propio, listados abajo), las tablas de site-trust (site_trust_*,
-- authorized_agents, authorized_escrow_providers) se definieron siempre
-- directo en este archivo maestro. No hay riesgo de que
-- generate-schema.mjs revierta este cambio por una fuente desactualizada.
--
-- Concatena, en un solo archivo idempotente, los esquemas que hasta ahora
-- vivian dispersos en cada paquete y requerian aplicarse a mano por
-- separado:
--   packages/auth/src/stores/schema.sql
--   packages/permissions/src/stores/schema.sql
--   packages/trust-layer/src/ledger/schema.sql
--   packages/atomic-elements/src/persistence/stores/schema.sql
--
-- Los archivos originales de cada paquete NO se eliminan ni se modifican
-- -- siguen siendo la fuente de verdad individual de cada modulo.
--
-- Aplicar este archivo:
--   Cloudflare D1:      wrangler d1 execute <NOMBRE_DB> --file=schema.sql
--   SQLite self-hosted: sqlite3 portaless.db < schema.sql
--   O usa el instalador completo (schema + admin inicial en un comando):
--   node scripts/setup.mjs
--
-- Todas las sentencias son CREATE TABLE/INDEX IF NOT EXISTS -- correr este
-- archivo repetidas veces sobre una base de datos que ya tiene las tablas
-- es seguro y no destruye datos existentes.

-- -----------------------------------------------------------------------------
-- @portaless/auth -- usuarios y sesiones (packages/auth/src/stores/schema.sql)
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
-- @portaless/permissions -- Centro de Permisos (packages/permissions/src/stores/schema.sql)
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
-- @portaless/trust-layer -- ledger de uso por agentes (packages/trust-layer/src/ledger/schema.sql)
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
-- @portaless/atomic-elements -- paginas persistidas (packages/atomic-elements/src/persistence/stores/schema.sql)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- -----------------------------------------------------------------------------
-- v0.0.9.4 -- Recuperacion de contrasena (packages/auth/src/password-reset-store.ts)
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
-- v0.0.9.9 -- Registro dinamico de plugins (packages/plugin-sandbox/src/registry/plugin-registry.ts)
-- -----------------------------------------------------------------------------
-- Reemplaza el catalogo hardcodeado (hello-plugin, commerce-plugin) que
-- functions/admin/permissions/index.js usaba desde v0.0.9.2. Modelo abierto
-- por defecto (Shopify App Store / WooCommerce.org / Android Play Store):
-- cualquiera puede registrar un plugin, y la comunidad regula la confianza
-- via trust_score (promedio de votos), no Portaless.

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
-- v0.0.9.19 -- Site Trust Score (packages/trust-layer/src/site-trust/site-trust-score.ts)
-- -----------------------------------------------------------------------------
-- Califica SITIOS completos (distinto de plugin_registry/plugin_trust_votes,
-- que califica plugins instalados). 4 fuentes en 4 tablas separadas -- cada
-- una con semantica de ausencia distinta, ver docs/architecture/
-- site-trust-score.md. Pensado para ser consultado por Protocol APW
-- (packages/apw-resolver/, hoy stub) al resolver identidad via did:web.

CREATE TABLE IF NOT EXISTS site_trust_subjects (
  site_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);

-- Fuente 1: self -- autoevaluacion declarativa del admin. Ausencia = neutral.
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

-- Fuente 2: agent -- verificacion automatizada via Web Bot Auth. `verified`
-- false es señal NEGATIVA real (el agente verifico y fallo), no ausencia.
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

-- Fuente 3: community -- visitantes humanos. Ausencia = neutral.
-- v0.0.9.19: agrega ip_hash para rate-limiting server-side. ip_hash es
-- SHA-256(ip + salt) -- la IP cruda nunca se persiste.
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

-- Fuente 4: escrow_report -- ground truth de transacciones reales,
-- reportadas por un tercero (Portaless nunca custodia fondos). Ausencia = neutral.
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
-- (v0.0.9.24 agrega key_algorithm por crypto-agilidad, ver nota debajo)
-- -----------------------------------------------------------------------------
-- Web Bot Auth (packages/trust-layer/src/site-trust/web-bot-auth.ts) resuelve
-- "¿quien eres?" -- esta tabla resuelve "¿tienes permiso?". Sin ella, cualquiera
-- que genere un par Ed25519 y publique un JWKS podria reportar verified:true
-- para cualquier sitio -- identidad verificada no es lo mismo que autorizacion.
--
-- Fase 1 (esta version): allowlist estricta, gestionada manualmente por
-- Portaless -- 1-2 agentes conocidos. Fase 2 (futura, no implementada):
-- abrir a cualquier agente verificado con peso reducido en el score, en vez
-- de bloquear por completo a agentes no listados. Ver docs/architecture/
-- site-trust-score.md.
--
-- key_algorithm (v0.0.9.24): Ed25519 (el unico algoritmo que
-- web-bot-auth.ts verifica hoy) es vulnerable a computadoras cuanticas via
-- el algoritmo de Shor. NIST ya estandarizo el reemplazo (FIPS 204,
-- ML-DSA). Esta columna NO implementa verificacion de un segundo
-- algoritmo -- solo deja el esquema listo para no requerir una migracion
-- de datos con filas reales ya en produccion el dia que se implemente. Ver
-- docs/architecture/site-trust-score.md, seccion "Crypto-agilidad".

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
-- Analoga a authorized_agents, pero para la fuente escrow_report en vez de
-- agent. No hay un estandar publico equivalente a Web Bot Auth para
-- proveedores de escrow -- el mecanismo aqui es una API key por proveedor,
-- hasheada antes de persistir (nunca la clave cruda), comparada contra el
-- header Authorization: Bearer <api_key> del request.
--
-- Esta es la parte MENOS "protocolo abierto" de todo SiteTrustScore: no hay
-- forma de que un proveedor se autoautorice como si pasa con Web Bot Auth
-- (cualquiera puede publicar un JWKS) -- Portaless emite la API key
-- manualmente, fuera de banda, la primera vez que un proveedor real se
-- integra. Coherente con que escrow_report es ground truth: la barrera de
-- entrada deliberadamente alta protege la fuente mas objetiva del diseño.
-- Ver docs/architecture/site-trust-score.md.

CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
  provider_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT NOT NULL,
  authorized_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_authorized_escrow_providers_active ON authorized_escrow_providers(active);
