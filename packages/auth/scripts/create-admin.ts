// Script de creación del usuario administrador inicial.
// Lee credenciales desde variables de entorno y nunca imprime la contraseña.

import { hashPassword } from "../src/password";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  const username = process.env.PORTALESS_ADMIN_USERNAME;
  const password = process.env.PORTALESS_ADMIN_PASSWORD;
  const sqlitePath = process.env.PORTALESS_SQLITE_PATH;

  if (!username || !password) {
    console.error("Faltan PORTALESS_ADMIN_USERNAME y/o PORTALESS_ADMIN_PASSWORD como variables de entorno.");
    process.exit(1);
  }

  if (!/^[A-Za-z0-9._@+-]{1,128}$/.test(username)) {
    console.error("El usuario contiene caracteres no permitidos o es demasiado largo.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const passwordHash = hashPassword(password);
  const createdAt = new Date().toISOString();

  if (sqlitePath) {
    const { SqliteUsersStore } = await import("../src/stores/sqlite-users-store");
    const store = new SqliteUsersStore(sqlitePath);
    const existing = await store.listUsers();
    if (existing.length > 0) {
      console.error(`Ya existen ${existing.length} usuario(s) en ${sqlitePath}. Este script solo crea el primer admin.`);
      process.exit(1);
    }
    await store.createUser(username, password, "admin");
    console.log(`Usuario administrador "${username}" creado en ${sqlitePath}.`);
    return;
  }

  const sql =
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (" +
    `${sqlString(username)}, ${sqlString(passwordHash)}, 'admin', ${sqlString(createdAt)});`;

  console.log("No se definió PORTALESS_SQLITE_PATH -- asumiendo despliegue en Cloudflare D1.");
  console.log("Ejecuta el siguiente SQL contra tu base D1 con Wrangler:\n");
  console.log(sql);
  console.log("\nGuárdalo en un archivo (ej. admin-insert.sql) y corre:");
  console.log("  wrangler d1 execute <NOMBRE_DB> --file=admin-insert.sql");
}

main();
