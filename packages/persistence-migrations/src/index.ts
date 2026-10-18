// Contrato de datos de Portaless: migraciones NUMERADAS hacia adelante.
//
// El problema que resuelve: hasta ahora `schema.sql` se re-aplicaba entero en
// cada arranque y cada store se auto-migraba con `ALTER TABLE ... ADD COLUMN`
// dispersos (swallow del dup-column). Funcionaba, pero no dejaba registro, ni
// orden, ni backup, ni proteccion contra una base MAS NUEVA que el codigo.
//
// Modelo:
//   - `schema_migrations` (version, name, applied_at) registra que migraciones
//     se aplicaron. La crea el runner.
//   - `SCHEMA_VERSION` es la version que este codigo espera. La forma COMPLETA
//     del schema vive en `schema.sql` (idempotente); las entradas de MIGRATIONS
//     son los deltas numerados.
//   - v1 = baseline: no lleva SQL (la crea `schema.sql`), solo deja registrada
//     la version para que futuras migraciones (v2, v3, ...) tengan una base.
//   - Fail-closed: si la base esta en una version MAYOR que el codigo, el
//     arranque se niega (no se degrada el schema en silencio).
//
// Modulo PURO (sin I/O, sin SQLite): lo importan el runner, el doctor y los
// tests, y tambien `functions/` y `server/`.

export interface Migration {
  version: number;
  name: string;
  /** Statements idempotentes. Vacio en el baseline (lo cubre schema.sql). */
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", statements: [] },
];

/** Version del schema que ESTE codigo espera (el maximo de MIGRATIONS). */
export function schemaVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}

/** Migraciones pendientes para una base que esta en `current`. */
export function pendingFrom(current: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
}

export class SchemaNewerThanCodeError extends Error {
  constructor(
    public readonly dbVersion: number,
    public readonly codeVersion: number,
  ) {
    super(
      `La base esta en la version ${dbVersion} y este codigo espera la ${codeVersion}. ` +
        "Actualiza el codigo (git pull / nueva imagen) antes de arrancar: no se degrada el schema.",
    );
    this.name = "SchemaNewerThanCodeError";
  }
}

/** Fail-closed: una base mas nueva que el codigo NO arranca. */
export function assertCompatible(dbVersion: number, codeVersion = schemaVersion()): void {
  if (dbVersion > codeVersion) throw new SchemaNewerThanCodeError(dbVersion, codeVersion);
}
