// Contratos del modulo de autenticacion. Extendido en v0.0.9.4 para cubrir
// 2FA (TOTP), recuperacion de contrasena, y OAuth/SSO -- documentado como
// pendiente en la version anterior (docs/architecture/authentication.md).
// Todos los campos nuevos son OPCIONALES para no romper UserRecord/
// SessionRecord ya persistidos por D1UsersStore/SqliteUsersStore de v0.0.6.

export type Role = "admin" | "viewer";

export type AuthProvider = "password" | "oauth";

export interface UserRecord {
  username: string;
  passwordHash: string;   // Formato: "scrypt:<salt-hex>:<hash-hex>" -- ver password.ts
  role: Role;
  createdAt: string;
  email?: string;                 // requerido para recuperacion de contrasena y notificaciones de OAuth-link.
  totpSecret?: string;            // secreto base32 TOTP, presente solo si el usuario activo 2FA. Ver totp.ts.
  totpEnabledAt?: string;
  provider?: AuthProvider;        // default implicito "password" si se omite (usuarios pre-v0.0.9.4).
  oauthSubject?: string;          // "sub" del proveedor OAuth, solo si provider === "oauth".
  oauthProvider?: string;         // ej. "google", "github" -- nombre del proveedor configurado.
}

export interface SessionRecord {
  token: string;          // Identificador aleatorio de sesion (NO el usuario/contrasena).
  username: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  mfaVerified?: boolean;   // true solo si el usuario tiene 2FA y ya paso el segundo factor en esta sesion.
}

export interface LoginResult {
  success: boolean;
  session?: SessionRecord;
  error?: string;
  mfaRequired?: boolean;   // true: login de password fue correcto, pero falta el codigo TOTP.
  mfaChallengeToken?: string; // token de corta duracion para completar el 2do paso en /admin/login/mfa.
}

export interface PasswordResetRequest {
  token: string;           // token aleatorio de un solo uso, enviado por email.
  username: string;
  createdAt: string;
  expiresAt: string;       // vida corta (ver password-reset-store.ts, 30 min por defecto).
  usedAt?: string;
}

export interface OAuthProfile {
  provider: string;    // "google", "github", etc. -- debe existir en OAUTH_PROVIDERS (oauth.ts).
  subject: string;     // "sub" (o "id") devuelto por el proveedor -- identificador estable.
  email?: string;
  displayName?: string;
}
