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
