// functions/admin/api/wizard/admin-status.js
//
// Endpoint de SOLO LECTURA para el Paso 5 del Wizard: informa si ya
// existe un usuario admin y que backend de persistencia esta activo, sin
// exponer ningun dato sensible (nunca usernames, nunca hashes).
//
// POLITICA DE CREACION DE ADMIN (actualizada por ADR-002, PR B):
// este endpoint sigue sin contraparte de escritura. Los mecanismos de
// creacion del primer admin son:
//   - `npm run setup` (CLI, SQLite self-hosted) y `npm run setup:d1` (D1).
//   - POST /api/setup/complete, SOLO en el runtime Node self-hosted y
//     protegido por un setup code de un solo uso (hash SHA-256, 60 minutos,
//     5 intentos, bloqueado si ya existe algun usuario). En Cloudflare Pages
//     ese endpoint responde 404. Ver .airchive/project_memory/adr-002-first-run-trust-root.md.
// Un endpoint de registro SIN esas protecciones seguiria siendo una puerta de
// escalada de privilegios.
//
// Sin autenticacion requerida -- a diferencia de los demas endpoints de
// functions/admin/api/, este debe ser accesible ANTES de que exista una
// sesion, porque su proposito es decirle a un usuario sin sesion que
// hacer para obtener una.
// NOTA (bug conocido, PR aparte): functions/admin/_middleware.js hoy solo
// excluye /admin/login, asi que esta ruta recibe un 302 sin sesion.
//
// v0.0.9.27:
//   - Ya no abre SQLite por su cuenta con node:sqlite: usa createUsersStore(env),
//     el MISMO camino que el login, asi lo que informa coincide con lo que
//     el login va a encontrar.
//   - Si el backend falla (D1 caido, SQLite que no abre, o SQLite nativo dentro
//     de workerd) responde 503 en vez de adminExists:false. Antes, cualquier
//     error le decia al usuario "crea tu admin" aunque ya existiera.
//   - adminExists cuenta solo usuarios con rol admin.

import { createUsersStore } from "../../../../packages/auth/src/store-factory";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const { env } = context;
  const backend = env?.DB ? "d1" : env?.PORTALESS_SQLITE_PATH ? "sqlite" : "memory";

  try {
    const store = await createUsersStore(env ?? {});
    const users = await store.listUsers();
    return json({ adminExists: users.some((u) => u.role === "admin"), backend });
  } catch (err) {
    return json({ error: "backend_unavailable", backend, message: err?.message ?? String(err) }, 503);
  }
}
