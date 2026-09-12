// Servicio central de autenticacion: login, logout, validacion de
// sesion. Es el unico punto de entrada que el resto del sistema
// (middleware de rutas /admin/*) deberia usar -- nunca leer UsersStore o
// SessionStore directamente desde otro modulo.

import type { LoginResult, Role } from "./types";
import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import { verifyPassword } from "./password";

export class AuthService {
  constructor(private users: UsersStore, private sessions: SessionStore) {}

  async login(username: string, plainPassword: string): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    const valid = verifyPassword(plainPassword, user.passwordHash);
    if (!valid) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    const session = await this.sessions.create(user.username, user.role);
    return { success: true, session };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  async validateSession(token: string | null): Promise<{ username: string; role: Role } | null> {
    if (!token) return null;
    const session = await this.sessions.get(token);
    if (!session) return null;
    return { username: session.username, role: session.role };
  }

  /** Util para el middleware: true si el rol tiene permiso de escritura en el dashboard. */
  canWrite(role: Role): boolean {
    return role === "admin";
  }
}
