// Persistencia real de usuarios para despliegues self-hosted (sin
// Cloudflare), usando el modulo nativo "node:sqlite" (DatabaseSync),
// disponible sin flags desde Node 22.5+. Se eligio sobre better-sqlite3
// deliberadamente para mantener el mismo principio ya aplicado en
// password.ts: evitar dependencias nativas externas que requieran
// compilacion en el servidor del usuario.
//
// Si tu version de Node es anterior a 22.5, esta clase lanzara un error
// claro al instanciarse -- no falla silenciosamente.

import type { UserRecord, Role } from "../types";
import type { UsersStore } from "../users-store";
import { hashPassword } from "../password";

export class SqliteUsersStore implements UsersStore {
  private db: any;

  constructor(dbPath: string) {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      throw new Error(
        "node:sqlite no esta disponible en este runtime. Requiere Node 22.5+ " +
        "(posiblemente con --experimental-sqlite en versiones intermedias). " +
        "Alternativa: instalar better-sqlite3 manualmente e implementar UsersStore sobre esa libreria."
      );
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare("SELECT username, password_hash, role, created_at FROM users WHERE username = ?")
      .get(username) as { username: string; password_hash: string; role: Role; created_at: string } | undefined;

    if (!row) return null;
    return {
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
    };
  }

  async createUser(username: string, plainPassword: string, role: Role): Promise<UserRecord> {
    const existing = await this.findByUsername(username);
    if (existing) throw new Error(`El usuario "${username}" ya existe.`);

    const record: UserRecord = {
      username,
      passwordHash: hashPassword(plainPassword),
      role,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .run(record.username, record.passwordHash, record.role, record.createdAt);

    return record;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = this.db
      .prepare("SELECT username, password_hash, role, created_at FROM users")
      .all() as Array<{ username: string; password_hash: string; role: Role; created_at: string }>;

    return rows.map((row) => ({
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
    }));
  }
}
