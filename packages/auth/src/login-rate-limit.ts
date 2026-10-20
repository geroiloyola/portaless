import { createHash } from "node:crypto";
import type { RateLimitStore } from "./ephemeral-auth-store";

export const LOGIN_LIMIT_PER_IP = 20;
export const LOGIN_LIMIT_PER_USER = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function loginRateLimitBuckets(ip: string, username: string) {
  return [
    `login:ip:${hash(ip)}`,
    `login:user:${hash(username.trim().toLowerCase())}`,
  ] as const;
}

/** Counts each attempt; successful password/MFA handoff clears its two buckets. */
export async function allowLoginAttempt(
  store: RateLimitStore,
  ip: string,
  username: string,
  now = Date.now(),
): Promise<{ allowed: boolean; buckets: readonly [string, string]; windowStart: number }> {
  const buckets = loginRateLimitBuckets(ip, username);
  const windowStart = Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  const ipCount = await store.hit(buckets[0], windowStart);
  const userCount = await store.hit(buckets[1], windowStart);
  return { allowed: ipCount <= LOGIN_LIMIT_PER_IP && userCount <= LOGIN_LIMIT_PER_USER, buckets, windowStart };
}

export async function clearLoginFailures(
  store: RateLimitStore,
  buckets: readonly [string, string],
  windowStart: number,
): Promise<void> {
  await Promise.all(buckets.map((bucket) => store.clear?.(bucket, windowStart)));
}
