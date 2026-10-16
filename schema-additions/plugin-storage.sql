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
