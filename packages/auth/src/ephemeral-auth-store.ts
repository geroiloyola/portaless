// Estado efimero de autenticacion que tiene que sobrevivir entre requests:
//   - MfaChallengeStore: challenges de 2FA emitidos por login() y consumidos
//     por completeMfaLogin(). Antes vivian en un Map del modulo, que en
//     Cloudflare es distinto en cada isolate y en self-host se pierde al
//     reiniciar.
//   - RateLimitStore: contadores por ventana fija (usado por
//     /admin/password-reset/request).
//
// Implementaciones persistentes en stores/d1-ephemeral-auth-store.ts y
// stores/sqlite-ephemeral-auth-store.ts. Las de memoria quedan para tests y
// para el fallback sin DB ni PORTALESS_SQLITE_PATH.
//
// Contrato de MfaChallengeStore (todas las implementaciones lo cumplen):
//   - get() devuelve null si el challenge no existe o vencio.
//   - recordFailure() suma 1 de forma atomica y devuelve el total nuevo, o
//     null si el challenge no existe o vencio.
//   - consume() borra el challenge y lo devuelve SOLO si existe, no vencio y
//     tiene menos de maxAttempts fallos. Es atomico: dos requests con el mismo
//     token no pueden consumirlo ambas.

import type { Role } from "./types";

export interface MfaChallengeRecord {
  username: string;
  role: Role;
  expiresAt: number;
  failedAttempts: number;
}

export interface MfaChallengeStore {
  create(token: string, record: { username: string; role: Role; expiresAt: number }): Promise<void>;
  get(token: string, now: number): Promise<MfaChallengeRecord | null>;
  recordFailure(token: string, now: number): Promise<number | null>;
  consume(token: string, now: number, maxAttempts: number): Promise<MfaChallengeRecord | null>;
  delete(token: string): Promise<void>;
}

export interface RateLimitStore {
  /** Suma 1 al bucket en la ventana dada y devuelve el total. Borra ventanas anteriores. */
  hit(bucket: string, windowStart: number): Promise<number>;
}

export class InMemoryMfaChallengeStore implements MfaChallengeStore {
  private challenges = new Map<string, MfaChallengeRecord>();

  async create(token: string, record: { username: string; role: Role; expiresAt: number }): Promise<void> {
    const now = Date.now();
    for (const [t, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(t);
    this.challenges.set(token, { ...record, failedAttempts: 0 });
  }

  async get(token: string, now: number): Promise<MfaChallengeRecord | null> {
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

  async consume(token: string, now: number, maxAttempts: number): Promise<MfaChallengeRecord | null> {
    const c = this.challenges.get(token);
    if (!c || c.expiresAt <= now || c.failedAttempts >= maxAttempts) return null;
    this.challenges.delete(token);
    return { ...c };
  }

  async delete(token: string): Promise<void> {
    this.challenges.delete(token);
  }
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, { windowStart: number; count: number }>();

  async hit(bucket: string, windowStart: number): Promise<number> {
    for (const [b, e] of this.counts) if (e.windowStart < windowStart) this.counts.delete(b);
    const e = this.counts.get(bucket);
    if (!e || e.windowStart !== windowStart) {
      this.counts.set(bucket, { windowStart, count: 1 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }
}

// Instancia compartida por el proceso: reproduce el comportamiento del Map de
// modulo anterior para los callers que no pasan un store (y para el fallback
// en memoria de la factory), asi varias instancias de AuthService del mismo
// proceso siguen viendo los mismos challenges.
export const sharedInMemoryMfaChallengeStore = new InMemoryMfaChallengeStore();
