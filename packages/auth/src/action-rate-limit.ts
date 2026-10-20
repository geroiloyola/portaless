import { createHash } from "node:crypto";
import type { RateLimitStore } from "./ephemeral-auth-store";

export interface ActionRateLimitOptions {
  action: string;
  ip: string;
  actor: string;
  ipLimit: number;
  actorLimit: number;
  windowMs: number;
  now?: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Persistent per-IP and per-actor quota for authenticated write endpoints. */
export async function allowActionRequest(store: RateLimitStore, options: ActionRateLimitOptions): Promise<boolean> {
  const now = options.now ?? Date.now();
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
  const ipCount = await store.hit(`${options.action}:ip:${hash(options.ip)}`, windowStart);
  const actorCount = await store.hit(`${options.action}:actor:${hash(options.actor.trim().toLowerCase())}`, windowStart);
  return ipCount <= options.ipLimit && actorCount <= options.actorLimit;
}
