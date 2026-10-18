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
