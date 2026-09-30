// Servicio central de autenticacion: login, logout, validacion de
// sesion, 2FA (TOTP), recuperacion de contrasena, y OAuth/SSO. Es el
// unico punto de entrada que el resto del sistema (middleware de rutas
// /admin/*) deberia usar -- nunca leer UsersStore/SessionStore/
// PasswordResetStore directamente desde otro modulo.
//
// v0.0.9.4: se agregan los metodos de 2FA/reset/OAuth. login() se
// mantiene 100% compatible -- si el usuario NO tiene 2FA activo, el
// comportamiento es identico al de v0.0.6 (login directo). Si SI tiene
// 2FA, login() devuelve mfaRequired:true en vez de una sesion, y el
// caller debe llamar a completeMfaLogin() con el codigo TOTP.
//
// v0.0.9.30:
//   - Historial: si se provee un PasswordEventStore (4to parametro,
//     opcional para no romper callers), completePasswordReset() y
//     changePassword() registran hora, IP y ubicacion aproximada. Nunca
//     la contrasena. Si el registro falla, el cambio NO se revierte (el
//     usuario ya tiene la contrasena nueva); se avisa por consola.
//   - verifyStepUp(): verificacion reforzada para acciones sensibles
//     (rotar did:apw, cambiar contrasena). Exige la contrasena actual y,
//     si el usuario tiene 2FA, ademas el codigo TOTP. Usuarios solo-OAuth
//     (sin contrasena) necesitan 2FA activo para pasarla. Un codigo por
//     email queda pendiente: no hay backend de email:send todavia.
//   - Cambiar o resetear la contrasena cierra TODAS las sesiones del
//     usuario (incluida la actual): si alguien tenia una sesion robada,
//     la pierde. Requiere SessionStore.destroyAllForUser(); si el backend
//     no lo implementa todavia, se avisa por consola.
//
// Limite de intentos MFA: cada challenge admite MFA_MAX_ATTEMPTS codigos
// incorrectos. Al agotarlos se borra y hay que volver a iniciar sesion (lo que
// exige la contrasena otra vez). PENDIENTE: pendingMfaChallenges vive en la
// memoria del proceso; en Cloudflare cada isolate tiene su propio Map y en
// self-host un reinicio los borra. Moverlo a D1/SQLite es un cambio aparte.

import { randomBytes } from "node:crypto";
import type { LoginResult, Role, OAuthProfile } from "./types";
import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import type { PasswordResetStore } from "./password-reset-store";
import type { PasswordEventContext, PasswordEventKind, PasswordEventStore } from "./password-event-store";
import { verifyPassword } from "./password";
import { verifyTotpCode, generateTotpSecret, buildTotpUri } from "./totp";

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 5;
interface PendingMfaChallenge {
  username: string;
  role: Role;
  expiresAt: number;
  failedAttempts: number;
}
const pendingMfaChallenges = new Map<string, PendingMfaChallenge>();

export interface StepUpCredentials {
  password?: string;
  totpCode?: string;
}

export type StepUpResult =
  | { ok: true }
  | { ok: false; reason: "user_not_found" | "password_required" | "invalid_password" | "totp_required" | "invalid_totp" | "no_step_up_factor" };

export class AuthService {
  constructor(
    private users: UsersStore,
    private sessions: SessionStore,
    private passwordResets?: PasswordResetStore,
    private passwordEvents?: PasswordEventStore
  ) {}

  async login(username: string, plainPassword: string): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    const valid = verifyPassword(plainPassword, user.passwordHash);
    if (!valid) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    if (user.totpSecret) {
      const challengeToken = randomBytes(24).toString("hex");
      pendingMfaChallenges.set(challengeToken, {
        username: user.username,
        role: user.role,
        expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS,
        failedAttempts: 0,
      });
      return { success: false, mfaRequired: true, mfaChallengeToken: challengeToken };
    }

    const session = await this.sessions.create(user.username, user.role);
    return { success: true, session };
  }

  async completeMfaLogin(challengeToken: string, totpCode: string): Promise<LoginResult> {
    const challenge = pendingMfaChallenges.get(challengeToken);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.failedAttempts >= MFA_MAX_ATTEMPTS) {
      pendingMfaChallenges.delete(challengeToken);
      return { success: false, error: "El código de verificación expiró. Inicia sesión de nuevo." };
    }

    const user = await this.users.findByUsername(challenge.username);
    if (!user || !user.totpSecret) {
      pendingMfaChallenges.delete(challengeToken);
      return { success: false, error: "No fue posible verificar el segundo factor." };
    }

    if (!verifyTotpCode(user.totpSecret, totpCode)) {
      challenge.failedAttempts += 1;
      if (challenge.failedAttempts >= MFA_MAX_ATTEMPTS) {
        pendingMfaChallenges.delete(challengeToken);
        return { success: false, error: "Demasiados códigos incorrectos. Inicia sesión de nuevo." };
      }
      return { success: false, error: "Código de verificación incorrecto." };
    }

    pendingMfaChallenges.delete(challengeToken);
    const session = await this.sessions.create(user.username, user.role);
    session.mfaVerified = true;
    return { success: true, session };
  }

  async beginTotpEnrollment(username: string): Promise<{ secret: string; uri: string }> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new Error(`El usuario "${username}" no existe.`);
    const secret = generateTotpSecret();
    return { secret, uri: buildTotpUri(secret, username) };
  }

  async confirmTotpEnrollment(username: string, secret: string, code: string): Promise<boolean> {
    if (!verifyTotpCode(secret, code)) return false;
    await this.users.setTotpSecret(username, secret);
    return true;
  }

  async disableTotp(username: string): Promise<void> {
    await this.users.clearTotpSecret(username);
  }

  /** Verificacion reforzada para acciones sensibles. Ver comentario del modulo. */
  async verifyStepUp(username: string, creds: StepUpCredentials): Promise<StepUpResult> {
    const user = await this.users.findByUsername(username);
    if (!user) return { ok: false, reason: "user_not_found" };

    const hasPassword = Boolean(user.passwordHash);
    const hasTotp = Boolean(user.totpSecret);
    if (!hasPassword && !hasTotp) return { ok: false, reason: "no_step_up_factor" };

    if (hasPassword) {
      if (!creds.password) return { ok: false, reason: "password_required" };
      if (!verifyPassword(creds.password, user.passwordHash)) return { ok: false, reason: "invalid_password" };
    }
    if (hasTotp) {
      if (!creds.totpCode) return { ok: false, reason: "totp_required" };
      if (!verifyTotpCode(user.totpSecret as string, creds.totpCode)) return { ok: false, reason: "invalid_totp" };
    }
    return { ok: true };
  }

  async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
    totpCode?: string,
    context: PasswordEventContext = {}
  ): Promise<{ success: boolean; error?: string }> {
    const check = await this.verifyStepUp(username, { password: currentPassword, totpCode });
    if (!check.ok) return { success: false, error: check.reason };
    await this.users.setPasswordByUsername(username, newPassword);
    if (this.passwordResets) await this.passwordResets.invalidateAllForUser(username);
    await this.revokeAllSessions(username);
    await this.recordPasswordEvent(username, "change", context);
    return { success: true };
  }

  async listPasswordEvents(username: string, limit = 20) {
    return this.passwordEvents ? this.passwordEvents.listForUser(username, limit) : [];
  }

  async requestPasswordReset(username: string): Promise<{ token: string } | null> {
    if (!this.passwordResets) {
      throw new Error("PasswordResetStore no configurado -- AuthService se construyo sin soporte de recuperación.");
    }
    const user = await this.users.findByUsername(username);
    if (!user) return null;
    const request = await this.passwordResets.create(username);
    return { token: request.token };
  }

  async completePasswordReset(
    token: string,
    newPassword: string,
    context: PasswordEventContext = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.passwordResets) {
      throw new Error("PasswordResetStore no configurado -- AuthService se construyo sin soporte de recuperación.");
    }
    const request = await this.passwordResets.consume(token);
    if (!request) {
      return { success: false, error: "El enlace de recuperación no es válido o ya expiró." };
    }
    await this.users.setPasswordByUsername(request.username, newPassword);
    await this.passwordResets.invalidateAllForUser(request.username);
    await this.revokeAllSessions(request.username);
    await this.recordPasswordEvent(request.username, "reset", context);
    return { success: true };
  }

  private async revokeAllSessions(username: string) {
    if (!this.sessions.destroyAllForUser) {
      console.warn(`[Portaless Auth] El SessionStore no implementa destroyAllForUser -- las sesiones abiertas de ${username} siguen activas.`);
      return;
    }
    await this.sessions.destroyAllForUser(username);
  }

  private async recordPasswordEvent(username: string, kind: PasswordEventKind, context: PasswordEventContext) {
    if (!this.passwordEvents) return;
    try {
      await this.passwordEvents.record({ username, kind, occurredAt: new Date().toISOString(), ...context });
    } catch (err) {
      console.warn(`[Portaless Auth] No se pudo registrar el evento de contrasena (${kind}) de ${username}: ${(err as Error).message}`);
    }
  }

  async loginWithOAuth(profile: OAuthProfile, defaultRole: Role = "viewer"): Promise<LoginResult> {
    let user = await this.users.findByOAuthSubject(profile.provider, profile.subject);

    if (!user) {
      const derivedUsername = deriveUsernameFromProfile(profile);
      const existingByUsername = await this.users.findByUsername(derivedUsername);
      if (existingByUsername) {
        await this.users.linkOAuthAccount(derivedUsername, profile.provider, profile.subject);
        user = await this.users.findByUsername(derivedUsername);
      } else {
        user = await this.users.createOAuthUser(derivedUsername, profile.provider, profile.subject, defaultRole, profile.email);
      }
    }

    if (!user) {
      return { success: false, error: "No fue posible completar el inicio de sesión con el proveedor externo." };
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

  canWrite(role: Role): boolean {
    return role === "admin";
  }
}

function deriveUsernameFromProfile(profile: OAuthProfile): string {
  if (profile.email) return profile.email.toLowerCase();
  return `${profile.provider}:${profile.subject}`;
}
