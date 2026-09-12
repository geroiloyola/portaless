// Contratos del modulo de autenticacion minima. Deliberadamente simple:
// dos roles, sin 2FA, sin OAuth, sin recuperacion de contrasena por email
// -- todo eso queda documentado como fuera de alcance en
// docs/architecture/authentication.md, para no aparentar mas seguridad
// de la que este MVP realmente ofrece.

export type Role = "admin" | "viewer";

export interface UserRecord {
  username: string;
  passwordHash: string;   // Formato: "scrypt:<salt-hex>:<hash-hex>" -- ver password.ts
  role: Role;
  createdAt: string;
}

export interface SessionRecord {
  token: string;          // Identificador aleatorio de sesion (NO el usuario/contrasena).
  username: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export interface LoginResult {
  success: boolean;
  session?: SessionRecord;
  error?: string;
}
