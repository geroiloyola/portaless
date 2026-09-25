#!/usr/bin/env node
// Comando unico de instalacion -- v0.0.9.4, tarea 4/4 del roadmap.
// v0.0.9.27: corregido tras prueba end-to-end real en Node 20.20.1.
//   - Antes el paso 2/2 imprimia "OK" aunque createUsersStore() hubiera
//     caido a InMemoryUsersStore en silencio (node:sqlite no disponible):
//     la tabla users quedaba vacia. Ahora usa SqliteUsersStore.open()
//     directo (better-sqlite3, falla ruidoso) y VERIFICA con una conexion
//     independiente que el admin exista en el archivo antes de decir OK.
//   - El paso 1/2 verifica que las tablas criticas existan tras aplicar
//     schema.sql (incluye las de OAuth de despliegue, v0.0.9.27).
//
//   npm run setup   (usa tsx: este script importa modulos .ts del repo)
//
// Variables de entorno:
//   PORTALESS_SQLITE_PATH     Ruta al archivo SQLite. Default "./portaless.db".
//   PORTALESS_ADMIN_USERNAME  Usuario admin inicial (default: "admin").
//   PORTALESS_ADMIN_PASSWORD  Contraseña admin inicial. Si se omite, se
//                             genera una aleatoria y se imprime UNA sola vez.
//
// Este script NO cubre Cloudflare D1 -- usa
// `wrangler d1 execute <NOMBRE_DB> --file=schema.sql`.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const sqlitePath = process.env.PORTALESS_SQLITE_PATH || join(rootDir, "portaless.db");
const adminUsername = process.env.PORTALESS_ADMIN_USERNAME || "admin";
const adminPasswordFromEnv = process.env.PORTALESS_ADMIN_PASSWORD;

const REQUIRED_TABLES = [
  "users",
  "sessions",
  "permission_grants",
  "pages",
  "site_identity",
  "capability_bridge_tokens",
  "deployment_oauth_states",
  "deployment_credentials",
];

function generateRandomPassword() {
  return randomBytes(18).toString("base64url");
}

async function loadDatabase() {
  try {
    return (await import("better-sqlite3")).default;
  } catch (err) {
    console.error("\nERROR: better-sqlite3 no esta instalado. Corre: npm install\n");
    throw err;
  }
}

async function applySchema() {
  console.log(`\n[1/2] Aplicando schema.sql a ${sqlitePath} ...`);
  const Database = await loadDatabase();

  const schemaPath = join(rootDir, "schema.sql");
  if (!existsSync(schemaPath)) {
    throw new Error(`No se encontro schema.sql en ${schemaPath}. Corre primero: node scripts/generate-schema.mjs`);
  }
  const schemaSql = readFileSync(schemaPath, "utf-8");

  const db = new Database(sqlitePath);
  db.exec(schemaSql);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  db.close();

  const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    throw new Error(`schema.sql se aplico pero faltan tablas criticas: ${missing.join(", ")}`);
  }
  console.log(`      OK -- ${tables.length} tablas presentes, incluidas las ${REQUIRED_TABLES.length} criticas.`);
}

async function createInitialAdmin() {
  console.log(`\n[2/2] Creando usuario admin inicial ("${adminUsername}") si no existe ninguno ...`);

  const { SqliteUsersStore } = await import("../packages/auth/src/stores/sqlite-users-store.ts");
  const { ensureInitialAdmin } = await import("../packages/auth/src/users-store.ts");

  const usersStore = await SqliteUsersStore.open(sqlitePath);
  let password = null;
  try {
    const existingUsers = await usersStore.listUsers();
    if (existingUsers.length > 0) {
      console.log(`      SKIP -- ya existen ${existingUsers.length} usuario(s) registrado(s). No se crea un admin nuevo.`);
      console.log("      (Si necesitas resetear, usa /admin/password-reset o borra manualmente la tabla 'users'.)");
      return;
    }
    password = adminPasswordFromEnv || generateRandomPassword();
    await ensureInitialAdmin(usersStore, adminUsername, password);
  } finally {
    usersStore.close();
  }

  const Database = await loadDatabase();
  const check = new Database(sqlitePath, { readonly: true });
  const row = check
    .prepare("SELECT count(*) AS n FROM users WHERE username = ? AND role = 'admin'")
    .get(adminUsername);
  check.close();
  if (!row || row.n !== 1) {
    throw new Error(
      `El admin "${adminUsername}" NO quedo persistido en ${sqlitePath} (verificacion independiente). ` +
        "No se imprime la contraseña porque la cuenta no existe."
    );
  }

  console.log(`      OK -- usuario "${adminUsername}" persistido y verificado en ${sqlitePath}.`);
  if (!adminPasswordFromEnv) {
    console.log("\n      ================================================================");
    console.log("      CONTRASEÑA GENERADA (guardala ahora, no se muestra de nuevo):");
    console.log(`      ${password}`);
    console.log("      ================================================================\n");
  }
}

async function main() {
  console.log("Portaless -- instalacion de base de datos + admin inicial (v0.0.9.27)");
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
