// Gestion de sesiones. Igual que el resto de los modulos nuevos de
// Portaless, el MVP usa un store en memoria -- se pierde al reiniciar el
// proceso. Ver docs/architecture/authentication.md para el plan de
// migracion a persistencia real (SQLite, coherente con el resto del
// roadmap de persistencia del proyecto).
//
// v0.0.9.30: destroyAllForUser() cierra todas las sesiones de un usuario
// (se usa al cambiar o resetear la contrasena). Es OPCIONAL en la interfaz
// para no romper D1SessionStore / SqliteSessionStore mientras no lo
// implementen: AuthService lo llama solo si existe y avisa si falta.

import { randomBytes } from "node:crypto";
import type { SessionRecord, Role } from "./types";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas.

export interface SessionStore {
  create(username: string, role: Role): Promise<SessionRecord>;
  get(token: string): Promise<SessionRecord | null>;
  destroy(token: string): Promise<void>;
  /** Cierra todas las sesiones del usuario. Devuelve cuantas cerro. */
  destroyAllForUser?(username: string): Promise<number>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(username: string, role: Role): Promise<SessionRecord> {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const record: SessionRecord = {
      token,
      username,
      role,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(token, record);
    return record;
  }

  async get(token: string): Promise<SessionRecord | null> {
    const record = this.sessions.get(token);
    if (!record) return null;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return record;
  }

  async destroy(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async destroyAllForUser(username: string): Promise<number> {
    let count = 0;
    for (const [token, record] of this.sessions) {
      if (record.username === username) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }
}
