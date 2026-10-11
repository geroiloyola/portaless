// Limite de pedidos de recuperacion de contrasena, por ventana fija de 1 hora:
//   - RESET_LIMIT_PER_IP pedidos por IP.
//   - RESET_LIMIT_PER_USER pedidos por username (normalizado a minusculas).
//
// El limite por usuario es la defensa principal. El por IP, para ser
// confiable, tiene que leer la IP que ya calculo el runtime:
//   - Cloudflare: CF-Connecting-IP (la fija el edge, el cliente no puede
//     falsificarla); en su ausencia, el primer valor de X-Forwarded-For.
//   - Self-host Node (v0.0.9.10): server/node-runtime.mjs descarta los
//     headers falsificables del cliente, resuelve la IP del socket contra
//     PORTALESS_TRUSTED_PROXIES (X-Forwarded-For solo si el socket es un
//     proxy confiable) y la escribe en x-portaless-client-ip. Antes este
//     modulo leia X-Forwarded-For crudo: en self-host cualquier atacante
//     rotaba el bucket por IP con un header inventado. Mismo caso que
//     getClientIp() en packages/trust-layer/src/net/client-ip.ts; aqui se
//     replica la regla para no crear una dependencia de paquete.
//
// Los buckets guardan SHA-256 de la IP y del username, no el valor en claro.
// El endpoint responde igual cuando se pasa el limite, para no revelar si el
// usuario existe ni si se lo limito.

import { createHash } from "node:crypto";
import type { RateLimitStore } from "./ephemeral-auth-store";

export const RESET_LIMIT_PER_IP = 5;
export const RESET_LIMIT_PER_USER = 3;
export const RESET_WINDOW_MS = 60 * 60 * 1000;

export const NODE_CLIENT_IP_HEADER = "x-portaless-client-ip";

export interface HeadersLike {
  get(name: string): string | null;
}

export interface RuntimeEnvLike {
  __PORTALESS_RUNTIME?: string;
}

export function clientIpFromHeaders(headers: HeadersLike, env?: RuntimeEnvLike | null): string {
  // Self-host Node: la única IP confiable es la que calculo el runtime;
  // CF-Connecting-IP y X-Forwarded-For en los headers pueden venir del
  // cliente (node-runtime los usa para calcular, no los borra de XFF).
  if (env?.__PORTALESS_RUNTIME === "node") {
    const internal = headers.get(NODE_CLIENT_IP_HEADER);
    if (internal && internal.trim()) return internal.trim();
    // Sin IP calculada (no deberia pasar): bucket unico compartido, que
    // no se puede rotar por header, en vez de creerle al cliente.
    return "unknown";
  }
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
