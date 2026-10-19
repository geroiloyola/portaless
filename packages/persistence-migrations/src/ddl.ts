// DDL de tablas que NO tienen un schema.sql de paquete propio.
//
// Vive ACA (y no en el store que la usa) para que exista UNA sola fuente de
// verdad entre:
//   - el store que la ejecuta (CREATE TABLE IF NOT EXISTS al abrir), y
//   - la migracion numerada que la registra en el libro mayor.
// Este modulo es HOJA (no importa nada): puede entrar al bundle de Cloudflare
// Pages Functions (el gate de migraciones importa `index.ts`, que importa esto)
// sin arrastrar better-sqlite3 ni el sandbox.
//
// Regla: el `schema-additions/*.sql` correspondiente es la fuente del maestro
// `schema.sql`; un test de paridad (migrations.test.ts) verifica que el texto
// normalizado coincida con esta constante, asi no pueden divergir.

/**
 * Cuota diaria de email por plugin (capacidad `email:send`). PK compuesta
 * (plugin_id, day) para el contador atomico del rate limit. Espeja
 * schema-additions/plugin-email-quota.sql.
 */
export const PLUGIN_EMAIL_QUOTA_DDL =
  "CREATE TABLE IF NOT EXISTS plugin_email_quota (" +
  "plugin_id TEXT NOT NULL, " +
  "day TEXT NOT NULL, " +
  "count INTEGER NOT NULL DEFAULT 0, " +
  "PRIMARY KEY (plugin_id, day))";
