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
