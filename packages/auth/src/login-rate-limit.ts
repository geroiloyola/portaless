import { createHash } from "node:crypto";
import type { RateLimitStore } from "./ephemeral-auth-store";

export const LOGIN_LIMIT_PER_IP = 20;
export const LOGIN_LIMIT_PER_USER = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPT_LIMIT_PER_IP = 60;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Presupuesto barato de intentos por IP, leído antes de ejecutar scrypt. */
export function loginAttemptLimit(env: Record<string, unknown> = {}): number {
  const raw = Number(env?.PORTALESS_LOGIN_ATTEMPTS_PER_IP);
  if (!Number.isInteger(raw) || raw < 1 || raw > 10_000) return LOGIN_ATTEMPT_LIMIT_PER_IP;
  return raw;
}

export function loginAttemptBucket(ip: string): string {
  return `login:attempt:ip:${hash(ip)}`;
}

export interface LoginAttemptState {
  bucket: string;
  windowStart: number;
  attempts: number;
  /** true cuando la IP supera el presupuesto de intentos; login.js responde 429 sin scrypt. */
  overLimit: boolean;
}

/**
 * Registra UN intento de login por IP, antes de verificar la contraseña.
 *
 * No cuenta fallos: es un techo de requests por ventana para que un atacante ya
 * bloqueado no siga consumiendo scrypt. No usa el bucket de usuario y no
 * reemplaza el anti-lockout: una contraseña válida sigue entrando mientras la
 * IP no haya agotado este presupuesto.
 */
export async function recordLoginAttempt(
  store: RateLimitStore,
  ip: string,
  now = Date.now(),
  limit = LOGIN_ATTEMPT_LIMIT_PER_IP,
): Promise<LoginAttemptState> {
  const bucket = loginAttemptBucket(ip);
  const windowStart = Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  const attempts = await store.hit(bucket, windowStart);
  return { bucket, windowStart, attempts, overLimit: attempts > limit };
}

export function loginRateLimitBuckets(ip: string, username: string) {
  return [
    `login:ip:${hash(ip)}`,
    `login:user:${hash(username.trim().toLowerCase())}`,
  ] as const;
}

export interface LoginFailureState {
  buckets: readonly [string, string];
  windowStart: number;
  ipFailures: number;
  userFailures: number;
  /** true cuando la IP supera el umbral; login.js responde 429 en ese caso. */
  ipOverLimit: boolean;
  /** true cuando el usuario supera el umbral. NUNCA se usa para rechazar: sería el lockout original. */
  userOverLimit: boolean;
}

/**
 * Registra UN fallo de login (nunca un exito).
 *
 * El endpoint verifica la contrasena primero. Si es correcta, no llama a esta
 * funcion y emite sesion/MFA aunque terceros hayan agotado el bucket. Asi un
 * atacante no puede bloquear al administrador legitimo con intentos fallidos.
 * Los contadores quedan para auditoria y para un futuro lock explicito de
 * cuenta, que debe ser una decision del operador y no un efecto del rate limit.
 */
export async function recordLoginFailure(
  store: RateLimitStore,
  ip: string,
  username: string,
  now = Date.now(),
): Promise<LoginFailureState> {
  const buckets = loginRateLimitBuckets(ip, username);
  const windowStart = Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  const ipFailures = await store.hit(buckets[0], windowStart);
  const userFailures = await store.hit(buckets[1], windowStart);
  return {
    buckets,
    windowStart,
    ipFailures,
    userFailures,
    ipOverLimit: ipFailures > LOGIN_LIMIT_PER_IP,
    userOverLimit: userFailures > LOGIN_LIMIT_PER_USER,
  };
}

export async function clearLoginFailures(
  store: RateLimitStore,
  buckets: readonly [string, string],
  windowStart: number,
): Promise<void> {
  await Promise.all(buckets.map((bucket) => store.clear?.(bucket, windowStart)));
}
