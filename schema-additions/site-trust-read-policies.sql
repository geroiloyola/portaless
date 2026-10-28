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
