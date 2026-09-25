// Unico punto del repo que abre SQLite self-hosted. v0.0.9.27.
// Backend unico: better-sqlite3 (binario prebuilt, funciona en Node 20 LTS).
// node:sqlite queda PROHIBIDO en el repo: requiere Node 22.5+ y, ademas, se
// cargaba con require() dentro de un paquete "type": "module", donde require
// no existe -- fallaba siempre y los factories caian a memoria en silencio.
//
// Regla: si PORTALESS_SQLITE_PATH esta definido y SQLite no abre, se LANZA
// error. Nunca degradar a memoria cuando el operador pidio persistencia.
export async function openSqlite(path: string): Promise<any> {
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
