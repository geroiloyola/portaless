// Limite de pedidos de recuperacion de contrasena, por ventana fija de 1 hora:
//   - RESET_LIMIT_PER_IP pedidos por IP.
//   - RESET_LIMIT_PER_USER pedidos por username (normalizado a minusculas).
//
// El limite por usuario es la defensa principal: la IP sale de
// CF-Connecting-IP (Cloudflare la fija) o del primer valor de
// X-Forwarded-For, que en self-host solo es confiable si el proxy de
// Railway/Render (o el tuyo) lo sobrescribe.
//
// Los buckets guardan SHA-256 de la IP y del username, no el valor en claro.
// El endpoint responde igual cuando se pasa el limite, para no revelar si el
// usuario existe ni si se lo limito.

import { createHash } from "node:crypto";
import type { RateLimitStore } from "./ephemeral-auth-store";

export const RESET_LIMIT_PER_IP = 5;
export const RESET_LIMIT_PER_USER = 3;
export const RESET_WINDOW_MS = 60 * 60 * 1000;

export interface HeadersLike {
  get(name: string): string | null;
}

export function clientIpFromHeaders(headers: HeadersLike): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return "unknown";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Devuelve true si el pedido puede seguir. Cuenta el pedido en ambos buckets. */
export async function allowPasswordResetRequest(
  store: RateLimitStore,
  ip: string,
  username: string,
  now: number = Date.now()
): Promise<boolean> {
  const windowStart = Math.floor(now / RESET_WINDOW_MS) * RESET_WINDOW_MS;
  const ipCount = await store.hit(`reset:ip:${sha256(ip)}`, windowStart);
  if (ipCount > RESET_LIMIT_PER_IP) return false;
  const userCount = await store.hit(`reset:user:${sha256(username.trim().toLowerCase())}`, windowStart);
  return userCount <= RESET_LIMIT_PER_USER;
}
