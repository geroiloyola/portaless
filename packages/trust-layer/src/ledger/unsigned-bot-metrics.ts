// Pure unsigned-bot UA family classifier (L2).
// SQLite/D1 persistence lives in `@portaless/trust-storage-adapters` (Node-L0).

export const BOT_FAMILIES = ["googlebot", "bingbot", "other", "unknown"] as const;
export type UnsignedBotFamily = (typeof BOT_FAMILIES)[number];

/** UA families are claims, never operator identities or verified search bots. */
export function unsignedBotFamily(ua: string | null): UnsignedBotFamily {
  if (!ua?.trim()) return "unknown";
  if (/googlebot/i.test(ua)) return "googlebot";
  if (/bingbot/i.test(ua)) return "bingbot";
  return "other";
}
