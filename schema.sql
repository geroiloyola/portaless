-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.9)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita el schema.sql del paquete correspondiente y
-- corre: node scripts/generate-schema.mjs
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
-- via trust_score (promedio de votos), no Portaless. NOTA: solo
-- InMemoryPluginRegistryStore existe por ahora -- estas tablas quedan
-- preparadas para cuando se implementen D1PluginRegistryStore /
-- SqlitePluginRegistryStore (fuera de alcance de v0.0.9.9, ver ROADMAP.md).

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
