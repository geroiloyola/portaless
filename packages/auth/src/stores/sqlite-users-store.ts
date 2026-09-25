// Persistencia real de usuarios para despliegues self-hosted (sin Cloudflare).
// v0.0.9.27: migrado de node:sqlite a better-sqlite3 via openSqlite().
// Motivo: node:sqlite requiere Node 22.5+, y se cargaba con require() en un
// paquete ESM, donde require no existe -- el constructor lanzaba SIEMPRE y
// createUsersStore() caia a InMemoryUsersStore en silencio (admin perdido).
//
// Uso: const store = await SqliteUsersStore.open(path);
// El constructor recibe una conexion ya abierta; pasarle un string lanza
// un error explicito en vez de fallar de forma ambigua.

import type { UserRecord, Role } from "../types";
import type { UsersStore } from "../users-store";
import { hashPassword } from "../password";
import { openSqlite } from "../../../sqlite-driver/src/open";

export class SqliteUsersStore implements UsersStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteUsersStore> {
    return new SqliteUsersStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteUsersStore ya no acepta una ruta en el constructor (v0.0.9.27). " +
          "Usa: await SqliteUsersStore.open(path)"
      );
    }
    this.db = db;
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

  close(): void {
    this.db.close();
  }
}
