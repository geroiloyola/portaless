#!/usr/bin/env node
// Comando unico de instalacion -- v0.0.9.4, tarea 4/4 del roadmap.
//
// Antes de este script, levantar una instancia nueva de Portaless requeria
// pasos manuales dispersos: aplicar 4 archivos schema.sql por separado (uno
// por paquete: auth, permissions, trust-layer, atomic-elements) y crear a
// mano el primer usuario admin invocando codigo TypeScript directamente.
// Este script hace ambas cosas con un solo comando:
//
//   node scripts/setup.mjs
//
// Variables de entorno relevantes (mismas que ya usa store-factory.ts en
// cada paquete -- este script no introduce nombres nuevos):
//   PORTALESS_SQLITE_PATH     Ruta al archivo SQLite self-hosted. Si se
//                             omite, usa "./portaless.db".
//   PORTALESS_ADMIN_USERNAME  Usuario admin inicial (default: "admin").
//   PORTALESS_ADMIN_PASSWORD  Contraseña admin inicial. Si se omite, se
//                             genera una aleatoria y se imprime UNA sola vez
//                             en la terminal -- no se guarda en ningun
//                             archivo ni log persistente.
//
// Este script NO cubre Cloudflare D1 -- D1 se administra con
// `wrangler d1 execute <NOMBRE_DB> --file=schema.sql` porque D1 vive en la
// infraestructura de Cloudflare, no en un archivo local que este proceso
// Node pueda tocar directamente. Para D1, corre ese comando de wrangler y
// luego usa el endpoint POST /admin/login -- ensureInitialAdmin se invoca
// igual del lado del Worker en el primer request si no hay usuarios.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const sqlitePath = process.env.PORTALESS_SQLITE_PATH || join(rootDir, "portaless.db");
const adminUsername = process.env.PORTALESS_ADMIN_USERNAME || "admin";
const adminPasswordFromEnv = process.env.PORTALESS_ADMIN_PASSWORD;

function generateRandomPassword() {
  return randomBytes(18).toString("base64url");
}

async function applySchema() {
  console.log(`\n[1/2] Aplicando schema.sql a ${sqlitePath} ...`);

  let Database;
  try {
    ({ default: Database } = await import("better-sqlite3"));
  } catch (err) {
    console.error(
      "\nERROR: better-sqlite3 no esta instalado. Instalalo con:\n" +
      "  npm install better-sqlite3\n" +
      "o aplica schema.sql manualmente con el CLI de sqlite3:\n" +
      `  sqlite3 ${sqlitePath} < schema.sql\n`
    );
    throw err;
  }

  const schemaPath = join(rootDir, "schema.sql");
  if (!existsSync(schemaPath)) {
    throw new Error(`No se encontro schema.sql en ${schemaPath}. Corre primero: node scripts/generate-schema.mjs`);
  }
  const schemaSql = readFileSync(schemaPath, "utf-8");

  const db = new Database(sqlitePath);
  db.exec(schemaSql);
  db.close();

  console.log("      OK -- tablas creadas/verificadas (users, sessions, permission_grants, usage_ledger, pages, password_reset_requests).");
}

async function createInitialAdmin() {
  console.log(`\n[2/2] Creando usuario admin inicial ("${adminUsername}") si no existe ninguno ...`);

  const { createUsersStore } = await import("../packages/auth/src/store-factory.ts");
  const { ensureInitialAdmin } = await import("../packages/auth/src/users-store.ts");

  const usersStore = await createUsersStore({ PORTALESS_SQLITE_PATH: sqlitePath });

  const existingUsers = await usersStore.listUsers();
  if (existingUsers.length > 0) {
    console.log(`      SKIP -- ya existen ${existingUsers.length} usuario(s) registrado(s). No se crea un admin nuevo.`);
    console.log("      (Si necesitas resetear, usa /admin/password-reset o borra manualmente la tabla 'users'.)");
    return;
  }

  const password = adminPasswordFromEnv || generateRandomPassword();
  await ensureInitialAdmin(usersStore, adminUsername, password);

  console.log(`      OK -- usuario "${adminUsername}" creado con rol admin.`);
  if (!adminPasswordFromEnv) {
    console.log("\n      ================================================================");
    console.log("      CONTRASEÑA GENERADA (guardala ahora, no se muestra de nuevo):");
    console.log(`      ${password}`);
    console.log("      ================================================================\n");
  }
}

async function main() {
  console.log("Portaless -- instalacion de base de datos + admin inicial (v0.0.9.4)");
  console.log(`Base de datos SQLite: ${sqlitePath}`);

  await applySchema();
  await createInitialAdmin();

  console.log("\nListo. Ya puedes iniciar sesion en /admin/login.");
  console.log("Nota: este script cubre SQLite self-hosted. Para Cloudflare D1, ver el");
  console.log("comentario al inicio de este archivo y de schema.sql en la raiz.\n");
}

main().catch((err) => {
  console.error("\nFallo la instalacion:", err.message);
  process.exit(1);
});
