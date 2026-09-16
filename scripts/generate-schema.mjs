#!/usr/bin/env node
// Genera schema.sql (raiz) concatenando los 4 archivos schema.sql
// individuales de cada paquete, en el orden documentado dentro del propio
// schema.sql resultante. Los 4 archivos originales siguen siendo la fuente
// de verdad -- este script existe para que nunca queden desincronizados si
// alguno de los 4 cambia en el futuro: en vez de editar el archivo maestro
// a mano, se edita el schema.sql del paquete correspondiente y se corre
// este generador de nuevo.
//
//   node scripts/generate-schema.mjs
//
// La unica seccion que NO viene de un archivo de paquete existente es la
// tabla password_reset_requests (v0.0.9.4) -- password-reset-store.ts
// todavia no tiene una implementacion D1/SQLite real (solo memoria, ver
// ROADMAP.md), asi que no existe un packages/auth/src/stores/schema.sql
// actualizado con esa tabla todavia. Se agrega aqui directamente, con una
// nota explicita, hasta que ese trabajo de persistencia real se haga y esta
// tabla pueda moverse al schema.sql de @portaless/auth.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const SOURCES = [
  { label: "@portaless/auth -- usuarios y sesiones", path: "packages/auth/src/stores/schema.sql" },
  { label: "@portaless/permissions -- Centro de Permisos", path: "packages/permissions/src/stores/schema.sql" },
  { label: "@portaless/trust-layer -- ledger de uso por agentes", path: "packages/trust-layer/src/ledger/schema.sql" },
  { label: "@portaless/atomic-elements -- paginas persistidas", path: "packages/atomic-elements/src/persistence/stores/schema.sql" },
];

const PASSWORD_RESET_ADDENDUM = `
-- -----------------------------------------------------------------------------
-- v0.0.9.4 -- Recuperacion de contrasena (packages/auth/src/password-reset-store.ts)
-- -----------------------------------------------------------------------------
-- NOTA: hoy password-reset-store.ts SOLO tiene implementacion en memoria
-- (InMemoryPasswordResetStore) -- D1/SQLite reales quedan fuera de alcance
-- de v0.0.9.4 (ver ROADMAP.md). Esta tabla se agrega ya preparada para no
-- requerir otra migracion cuando se implemente esa persistencia real.

CREATE TABLE IF NOT EXISTS password_reset_requests (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_username ON password_reset_requests(username);
`;

const HEADER = `-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.4)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita el schema.sql del paquete correspondiente
-- (ver la lista de fuentes al inicio de generate-schema.mjs) y corre:
--   node scripts/generate-schema.mjs
--
-- Aplicar este archivo:
--   Cloudflare D1:      wrangler d1 execute <NOMBRE_DB> --file=schema.sql
--   SQLite self-hosted: sqlite3 portaless.db < schema.sql
--   O usa el instalador completo (schema + admin inicial en un comando):
--   node scripts/setup.mjs
--
-- Todas las sentencias son CREATE TABLE/INDEX IF NOT EXISTS -- correr este
-- archivo repetidas veces sobre una base de datos existente es seguro.
`;

function main() {
  const parts = [HEADER];

  for (const source of SOURCES) {
    const fullPath = join(rootDir, source.path);
    const content = readFileSync(fullPath, "utf-8").trim();
    parts.push(`\n-- -----------------------------------------------------------------------------\n-- ${source.label} (${source.path})\n-- -----------------------------------------------------------------------------\n\n${content}\n`);
  }

  parts.push(PASSWORD_RESET_ADDENDUM);

  const outputPath = join(rootDir, "schema.sql");
  writeFileSync(outputPath, parts.join(""), "utf-8");
  console.log(`schema.sql regenerado en ${outputPath} a partir de ${SOURCES.length} fuentes + addendum de password reset.`);
}

main();
