// Challenges de step-up por email (codigo OTP de un solo uso enviado al
// email del usuario). Mismo patron que los challenges MFA de
// ephemeral-auth-store.ts: token aleatorio como PRIMARY KEY, expires_at en
// epoch ms, maximo de fallos antes de quemar el challenge. Diferencia:
// aqui se guarda el SHA-256 del codigo (el codigo lo genera Portaless y el
// usuario lo teclea), no un TOTP verificable por algoritmo.
//
// Base del step-up por email (ROADMAP): los endpoints todavia no lo usan
// (siguen con contrasena + TOTP); esta es la primitiva para cablearla.
// Ver AuthService.requestEmailStepUpCode()/verifyEmailStepUpCode().

export const EMAIL_STEPUP_TTL_MS = 10 * 60 * 1000;
export const EMAIL_STEPUP_MAX_ATTEMPTS = 5;

export interface EmailStepUpChallenge {
  username: string;
  codeHash: string;
  expiresAt: number; // epoch ms
  failedAttempts: number;
}

export interface EmailStepUpStore {
  create(token: string, record: { username: string; codeHash: string; expiresAt: number }): Promise<void>;
  get(token: string, now: number): Promise<EmailStepUpChallenge | null>;
  recordFailure(token: string, now: number): Promise<number | null>;
  consume(token: string, now: number, maxAttempts: number): Promise<EmailStepUpChallenge | null>;
  delete(token: string): Promise<void>;
}

export class InMemoryEmailStepUpStore implements EmailStepUpStore {
  private challenges = new Map<string, EmailStepUpChallenge>();

  async create(token: string, record: { username: string; codeHash: string; expiresAt: number }): Promise<void> {
    const now = Date.now();
    for (const [t, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(t);
    this.challenges.set(token, { ...record, failedAttempts: 0 });
  }

  async get(token: string, now: number): Promise<EmailStepUpChallenge | null> {
    const c = this.challenges.get(token);
    if (!c || c.expiresAt <= now) return null;
    return { ...c };
  }

  async recordFailure(token: string, now: number): Promise<number | null> {
    const c = this.challenges.get(token);
    if (!c || c.expiresAt <= now) return null;
    c.failedAttempts += 1;
    return c.failedAttempts;
  }

  async consume(token: string, now: number, maxAttempts: number): Promise<EmailStepUpChallenge | null> {
    const c = this.challenges.get(token);
    if (!c || c.expiresAt <= now || c.failedAttempts >= maxAttempts) return null;
    this.challenges.delete(token);
    return { ...c };
  }

  async delete(token: string): Promise<void> {
    this.challenges.delete(token);
  }

  /** Solo para tests: cuenta los challenges vivos (p. ej. verificar que un envio fallido no deja un codigo huerfano). */
  size(): number {
    return this.challenges.size;
  }
}
