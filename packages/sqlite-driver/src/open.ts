// Unico punto del repo que abre SQLite self-hosted. v0.0.9.27.
// Backend unico: better-sqlite3 (binario prebuilt, funciona en Node 20 LTS).
// node:sqlite queda PROHIBIDO en el repo: requiere Node 22.5+ y, ademas, se
// cargaba con require() dentro de un paquete "type": "module", donde require
// no existe -- fallaba siempre y los factories caian a memoria en silencio.
//
// Regla: si PORTALESS_SQLITE_PATH esta definido y SQLite no abre, se LANZA
// error. Nunca degradar a memoria cuando el operador pidio persistencia.
//
// v0.0.9.27 (guardia de runtime): better-sqlite3 es un binario nativo .node.
// workerd (Cloudflare Pages Functions / Workers, incluido wrangler pages dev)
// es un sandbox V8 que NO ejecuta binarios nativos. Sin esta guardia el
// import revienta con errores cripticos de Miniflare ("__filename is not
// defined" en bindings.js, "Promise will never complete"). La guardia corre
// ANTES del import para que el modulo nativo nunca llegue a evaluarse.

export function isWorkerdRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

export async function openSqlite(path: string): Promise<any> {
  if (isWorkerdRuntime()) {
    throw new Error(
      "SQLite nativo (better-sqlite3) no puede ejecutarse en Cloudflare Pages Functions (workerd). " +
        `PORTALESS_SQLITE_PATH="${path}" esta definido pero no hay binding D1 (env.DB). ` +
        "Usa el binding de D1 (en local: wrangler pages dev --d1 DB) o ejecuta el servidor en Node.js puro."
    );
  }
  let Database: any;
  try {
    ({ default: Database } = await import("better-sqlite3"));
  } catch (e) {
    throw new Error(
      `PORTALESS_SQLITE_PATH="${path}" esta definido pero better-sqlite3 no se pudo cargar ` +
        `(${(e as Error).message}). Instalalo con: npm install better-sqlite3`
    );
  }
  return new Database(path);
}
