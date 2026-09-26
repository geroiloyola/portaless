// functions/admin/api/wizard/admin-status.js
//
// Endpoint de SOLO LECTURA para el Paso 5 del Wizard: informa si ya
// existe un usuario admin y que backend de persistencia esta activo, sin
// exponer ningun dato sensible (nunca usernames, nunca hashes).
//
// DECISION DE SEGURIDAD DELIBERADA: este endpoint NO tiene ninguna
// contraparte de escritura. El unico mecanismo real de creacion de admin
// es `npm run setup` (CLI, SQLite self-hosted) o `npm run setup:d1`
// (Wrangler CLI, D1). Un endpoint de registro sin proteccion seria una
// puerta de escalada de privilegios.
//
// Sin autenticacion requerida -- a diferencia de los demas endpoints de
// functions/admin/api/, este debe ser accesible ANTES de que exista una
// sesion, porque su proposito es decirle a un usuario sin sesion que
// hacer para obtener una.
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
