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
