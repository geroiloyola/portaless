-- packages/apw-resolver/schema.sql
--
-- Fuente de verdad de site_identity -- ver packages/apw-resolver/src/did-apw/
-- site-identity-store.ts para la logica de cifrado/descifrado, y el
-- schema.sql maestro (raiz del repo) para el comentario completo de diseño.
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
