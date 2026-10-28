import { createHash } from "node:crypto";

/** SHA-256 for opaque bearer tokens stored at rest (sessions, reset links). */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
