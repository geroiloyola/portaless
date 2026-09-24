// functions/admin/api/wizard/admin-status.js
//
// Endpoint de SOLO LECTURA para el Paso 5 del Wizard: informa si ya
// existe un usuario admin y que backend de persistencia esta activo, sin
// exponer ningun dato sensible (nunca usernames, nunca hashes).
//
// DECISION DE SEGURIDAD DELIBERADA: este endpoint NO tiene ninguna
// contraparte de escritura. El unico mecanismo real de creacion de admin
// es `npm run setup` (CLI, SQLite self-hosted) o la creacion automatica
// del primer admin en D1 al primer login. Un endpoint de registro sin
// proteccion seria una puerta de escalada de privilegios.
//
// Sin autenticacion requerida -- a diferencia de los demas endpoints de
// functions/admin/api/, este debe ser accesible ANTES de que exista una
// sesion, porque su proposito es decirle a un usuario sin sesion que
// hacer para obtener una.

export async function onRequestGet(context) {
  const { env } = context;

  let backend = "memory";
  let adminExists = false;

  if (env.DB) {
    backend = "d1";
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
      adminExists = (row?.count ?? 0) > 0;
    } catch {
      adminExists = false;
    }
  } else if (env.PORTALESS_SQLITE_PATH) {
    backend = "sqlite";
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(env.PORTALESS_SQLITE_PATH);
      const row = db.prepare("SELECT COUNT(*) as count FROM users").get();
      adminExists = (row?.count ?? 0) > 0;
    } catch {
      adminExists = false;
    }
  }

  return new Response(JSON.stringify({ adminExists, backend }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
