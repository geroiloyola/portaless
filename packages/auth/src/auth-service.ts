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
//     (sin contrasena) necesitan 2FA activo para pasarla.
//   - Step-up por email (v0.0.9.10): requestEmailStepUpCode() genera un
//     codigo OTP de un solo uso (8 digitos, TTL 10 min, maximo 5 fallos),
//     lo hashea (nunca se guarda en claro) en un EmailStepUpStore y lo
//     envia por un EmailSender (SMTP/webhook transaccional del operador o
//     captura en dev; ver email-sender.ts). verifyEmailStepUpCode()
//     valida y consume el codigo. PRIMITIVA BASE: los endpoints todavia
//     no la usan (siguen con contrasena + TOTP); cablearla en las
//     acciones sensibles queda pendiente de revision en ROADMAP.md.
//   - Cambiar o resetear la contrasena cierra TODAS las sesiones del
//     usuario (incluida la actual): si alguien tenia una sesion robada,
//     la pierde. Requiere SessionStore.destroyAllForUser(); si el backend
//     no lo implementa todavia, se avisa por consola.
//
// Limite de intentos MFA: cada challenge admite MFA_MAX_ATTEMPTS codigos
// incorrectos. Al agotarlos se borra y hay que volver a iniciar sesion (lo que
// exige la contrasena otra vez).
//
// Challenges MFA persistentes: se guardan en un MfaChallengeStore (5to
// parametro, opcional). login.js y login-mfa.js deben pasar el de
// createMfaChallengeStore(env) para que el challenge emitido en una request
// exista en la siguiente (en Cloudflare cada isolate tiene su memoria, y en
// self-host un reinicio la borra). Si no se pasa, se usa un store en memoria
// compartido por el proceso: mismo comportamiento que el Map de antes.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LoginResult, Role, OAuthProfile } from "./types";
import type { UsersStore } from "./users-store";
import type { SessionStore } from "./session-store";
import type { PasswordResetStore } from "./password-reset-store";
import type { PasswordEventContext, PasswordEventKind, PasswordEventStore } from "./password-event-store";
import type { MfaChallengeStore } from "./ephemeral-auth-store";
import type { EmailStepUpStore } from "./email-stepup-store";
import type { EmailSender } from "./email-sender";
import { sharedInMemoryMfaChallengeStore } from "./ephemeral-auth-store";
import { EMAIL_STEPUP_MAX_ATTEMPTS, EMAIL_STEPUP_TTL_MS } from "./email-stepup-store";
import { EmailBackendUnavailableError } from "./email-sender";
import { verifyPassword, hashPassword, passwordNeedsRehash } from "./password";
import { verifyTotpCode, generateTotpSecret, buildTotpUri } from "./totp";

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 5;

// M-02: un usuario inexistente debe costar lo mismo que uno existente con
// password incorrecta. El hash dummy se calcula una vez por proceso.
let dummyPasswordHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= Promise.resolve(hashPassword(`portaless-dummy:${randomBytes(16).toString("hex")}`));
  return dummyPasswordHashPromise;
}

const MFA_EXPIRED_ERROR = "El código de verificación expiró. Inicia sesión de nuevo.";

export interface StepUpCredentials {
  password?: string;
  totpCode?: string;
}

export type StepUpResult =
  | { ok: true }
  | { ok: false; reason: "user_not_found" | "password_required" | "invalid_password" | "totp_required" | "invalid_totp" | "no_step_up_factor" };

export type EmailStepUpIssueResult =
  | { sent: true; token: string; expiresAt: number }
  | { sent: false; reason: "user_not_found" | "user_has_no_email" | "no_email_backend" | "email_send_failed" };

export type EmailStepUpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid_or_expired" | "invalid_code" | "max_attempts_exhausted" };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codeHashMatches(hash: string, code: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const actual = createHash("sha256").update(code).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Codigo OTP de 8 digitos sin sesgo: rechazo sobre randomBytes(4)
// (los valores >= 2^32 - (2^32 % 1e8) se descartan). No es un secreto de
// larga vida: TTL 10 min + maximo 5 intentos.
function randomEmailOtpCode(): string {
  const LIMIT = 100_000_000;
  const RANGE = 0x1_0000_0000; // 2^32
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= RANGE - (RANGE % LIMIT));
  return String(value % LIMIT).padStart(8, "0");
}

export class AuthService {
  constructor(
    private users: UsersStore,
    private sessions: SessionStore,
    private passwordResets?: PasswordResetStore,
    private passwordEvents?: PasswordEventStore,
    private mfaChallenges: MfaChallengeStore = sharedInMemoryMfaChallengeStore
  ) {}

  async login(username: string, plainPassword: string): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);
    const passwordHash = user?.passwordHash ?? await dummyPasswordHash();
    const valid = verifyPassword(plainPassword, passwordHash);
    if (!user || !valid) {
      return { success: false, error: "Usuario o contraseña incorrectos." };
    }

    // A-08: migra el hash viejo en el primer login exitoso. No invalida la
    // sesion que se esta creando; el resto de sesiones sigue igual.
    if (passwordNeedsRehash(user.passwordHash)) {
      await this.users.setPasswordByUsername(user.username, plainPassword);
    }

    if (user.totpSecret) {
      const challengeToken = randomBytes(24).toString("hex");
      await this.mfaChallenges.create(challengeToken, {
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
    const challenge = await this.mfaChallenges.get(challengeToken, Date.now());
    if (!challenge || challenge.failedAttempts >= MFA_MAX_ATTEMPTS) {
      await this.mfaChallenges.delete(challengeToken);
      return { success: false, error: MFA_EXPIRED_ERROR };
    }

    const user = await this.users.findByUsername(challenge.username);
    if (!user || !user.totpSecret) {
      await this.mfaChallenges.delete(challengeToken);
      return { success: false, error: "No fue posible verificar el segundo factor." };
    }

    if (!verifyTotpCode(user.totpSecret, totpCode)) {
      const failures = await this.mfaChallenges.recordFailure(challengeToken, Date.now());
      if (failures === null) {
        return { success: false, error: MFA_EXPIRED_ERROR };
      }
      if (failures >= MFA_MAX_ATTEMPTS) {
        await this.mfaChallenges.delete(challengeToken);
        return { success: false, error: "Demasiados códigos incorrectos. Inicia sesión de nuevo." };
      }
      return { success: false, error: "Código de verificación incorrecto." };
    }

    // consume() es atomico: si otra request ya uso este challenge (o agoto los
    // intentos) entre el get() y aca, devuelve null y no se emite sesion.
    const consumed = await this.mfaChallenges.consume(challengeToken, Date.now(), MFA_MAX_ATTEMPTS);
    if (!consumed) {
      return { success: false, error: MFA_EXPIRED_ERROR };
    }

    const session = await this.sessions.create(user.username, user.role, { mfaVerified: true });
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

  /** Step-up por email: emite un codigo OTP de un solo uso al email del usuario. Ver comentario del modulo. */
  async requestEmailStepUpCode(
    username: string,
    store: EmailStepUpStore,
    sender: EmailSender
  ): Promise<EmailStepUpIssueResult> {
    const user = await this.users.findByUsername(username);
    if (!user) return { sent: false, reason: "user_not_found" };
    if (!user.email) return { sent: false, reason: "user_has_no_email" };

    const code = randomEmailOtpCode();
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + EMAIL_STEPUP_TTL_MS;
    await store.create(token, { username, codeHash: sha256Hex(code), expiresAt });

    try {
      await sender.send({
        to: user.email,
        subject: "Portaless - codigo de verificacion",
        text:
          `Tu codigo de verificacion es: ${code}\n` +
          `Vence en ${Math.round(EMAIL_STEPUP_TTL_MS / 60000)} minutos y solo puede usarse una vez. ` +
          `Si no pediste este codigo, ignora este mensaje.`,
      });
    } catch (err) {
      // El codigo nunca salio: no dejar un challenge huerfano que nadie
      // podra usar, y reportar el motivo real (nunca un exito silencioso).
      await store.delete(token);
      if (err instanceof EmailBackendUnavailableError) return { sent: false, reason: "no_email_backend" };
      return { sent: false, reason: "email_send_failed" };
    }

    return { sent: true, token, expiresAt };
  }

  /** Step-up por email: valida y consume el codigo enviado. Un solo uso, maximo EMAIL_STEPUP_MAX_ATTEMPTS fallos. */
  async verifyEmailStepUpCode(
    token: string,
    code: string,
    store: EmailStepUpStore,
    now: number = Date.now()
  ): Promise<EmailStepUpVerifyResult> {
    const challenge = await store.get(token, now);
    if (!challenge) return { ok: false, reason: "invalid_or_expired" };

    if (!codeHashMatches(challenge.codeHash, code)) {
      const failures = await store.recordFailure(token, now);
      if (failures !== null && failures >= EMAIL_STEPUP_MAX_ATTEMPTS) {
        await store.consume(token, now, EMAIL_STEPUP_MAX_ATTEMPTS); // quema el challenge
        return { ok: false, reason: "max_attempts_exhausted" };
      }
      return { ok: false, reason: "invalid_code" };
    }

    const consumed = await store.consume(token, now, EMAIL_STEPUP_MAX_ATTEMPTS);
    if (!consumed) return { ok: false, reason: "invalid_or_expired" };
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
        // Vincular una cuenta existente por email SOLO si el proveedor lo
        // declara verificado y coincide con el email guardado. Nunca por el
        // username derivado a solas, y nunca pisando otro binding OAuth.
        const profileEmail = normalizeEmail(profile.email);
        const accountEmail = normalizeEmail(existingByUsername.email);
        if (!profile.emailVerified || !profileEmail || !accountEmail || profileEmail !== accountEmail) {
          return {
            success: false,
            error: "No se puede vincular automáticamente. Inicia sesión con contraseña y vincula el proveedor desde el panel.",
          };
        }
        const alreadyBoundToAnotherProvider =
          Boolean(existingByUsername.oauthSubject) &&
          (existingByUsername.oauthSubject !== profile.subject ||
            existingByUsername.oauthProvider !== profile.provider);
        if (alreadyBoundToAnotherProvider) {
          return { success: false, error: "Esta cuenta ya está vinculada a otro proveedor." };
        }
        await this.users.linkOAuthAccount(existingByUsername.username, profile.provider, profile.subject);
        user = await this.users.findByUsername(existingByUsername.username);
      } else {
        user = await this.users.createOAuthUser(derivedUsername, profile.provider, profile.subject, defaultRole, profile.email);
      }
    }

    if (!user) {
      return { success: false, error: "No fue posible completar el inicio de sesión con el proveedor externo." };
    }

    // OAuth no puede saltar el segundo factor: un usuario con TOTP activo
    // recibe el mismo challenge que login() y no obtiene sesion hasta
    // completeMfaLogin().
    if (user.totpSecret) {
      const challengeToken = randomBytes(24).toString("hex");
      await this.mfaChallenges.create(challengeToken, {
        username: user.username,
        role: user.role,
        expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS,
      });
      return { success: false, mfaRequired: true, mfaChallengeToken: challengeToken };
    }

    const session = await this.sessions.create(user.username, user.role);
    return { success: true, session };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  async validateSession(token: string | null): Promise<{ username: string; role: Role; mfaVerified: boolean } | null> {
    if (!token) return null;
    const session = await this.sessions.get(token);
    if (!session) return null;
    return { username: session.username, role: session.role, mfaVerified: session.mfaVerified === true };
  }

  canWrite(role: Role): boolean {
    return role === "admin";
  }
}

function normalizeEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function deriveUsernameFromProfile(profile: OAuthProfile): string {
  const email = normalizeEmail(profile.email);
  if (email) return email;
  return `${profile.provider}:${profile.subject}`;
}
