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

import { randomBytes } from "node:crypto";
import type { LoginResult, Role, OAuthProfile } from "./types";
import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import type { PasswordResetStore } from "./password-reset-store";
import { verifyPassword } from "./password";
import { verifyTotpCode, generateTotpSecret, buildTotpUri } from "./totp";

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
interface PendingMfaChallenge {
  username: string;
  role: Role;
  expiresAt: number;
}
const pendingMfaChallenges = new Map<string, PendingMfaChallenge>();

export class AuthService {
  constructor(
    private users: UsersStore,
    private sessions: SessionStore,
    private passwordResets?: PasswordResetStore
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
      });
      return { success: false, mfaRequired: true, mfaChallengeToken: challengeToken };
    }

    const session = await this.sessions.create(user.username, user.role);
    return { success: true, session };
  }

  async completeMfaLogin(challengeToken: string, totpCode: string): Promise<LoginResult> {
    const challenge = pendingMfaChallenges.get(challengeToken);
    if (!challenge || challenge.expiresAt < Date.now()) {
      pendingMfaChallenges.delete(challengeToken);
      return { success: false, error: "El código de verificación expiró. Inicia sesión de nuevo." };
    }

    const user = await this.users.findByUsername(challenge.username);
    if (!user || !user.totpSecret) {
      pendingMfaChallenges.delete(challengeToken);
      return { success: false, error: "No fue posible verificar el segundo factor." };
    }

    if (!verifyTotpCode(user.totpSecret, totpCode)) {
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

  async requestPasswordReset(username: string): Promise<{ token: string } | null> {
    if (!this.passwordResets) {
      throw new Error("PasswordResetStore no configurado -- AuthService se construyo sin soporte de recuperación.");
    }
    const user = await this.users.findByUsername(username);
    if (!user) return null;
    const request = await this.passwordResets.create(username);
    return { token: request.token };
  }

  async completePasswordReset(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!this.passwordResets) {
      throw new Error("PasswordResetStore no configurado -- AuthService se construyo sin soporte de recuperación.");
    }
    const request = await this.passwordResets.consume(token);
    if (!request) {
      return { success: false, error: "El enlace de recuperación no es válido o ya expiró." };
    }
    await this.users.setPasswordByUsername(request.username, newPassword);
    await this.passwordResets.invalidateAllForUser(request.username);
    return { success: true };
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
