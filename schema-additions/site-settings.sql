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
