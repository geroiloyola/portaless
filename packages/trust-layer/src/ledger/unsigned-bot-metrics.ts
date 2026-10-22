import { SITE_SETTINGS_TABLE_DDL } from "../../../dashboard/src/site-settings/site-settings-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

export const BOT_FAMILIES = ["googlebot", "bingbot", "other", "unknown"] as const;
type Family = typeof BOT_FAMILIES[number];
type Env = { DB?: any; PORTALESS_SQLITE_PATH?: string };
const PREFIX = "unsigned_bot_rejections:";
const memory = new Map<string, number>();

/** UA families are claims, never operator identities or verified search bots. */
export function unsignedBotFamily(ua: string | null): Family {
  if (!ua?.trim()) return "unknown";
  if (/googlebot/i.test(ua)) return "googlebot";
  if (/bingbot/i.test(ua)) return "bingbot";
  return "other";
}

function cutoff(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString().slice(0, 7);
}
async function database(env: Env) {
  if (env?.DB) return { db: env.DB, d1: true };
  if (env?.PORTALESS_SQLITE_PATH) return { db: await openSqlite(env.PORTALESS_SQLITE_PATH), d1: false };
  return null;
}

export async function recordUnsignedBotRejection(env: Env, ua: string | null, now = new Date()): Promise<void> {
  // Never persist raw UA, IP, URL, signature, key, or identity; only 4 buckets/month.
  const key = `${PREFIX}${now.toISOString().slice(0, 7)}:${unsignedBotFamily(ua)}`;
  const before = `${PREFIX}${cutoff(now)}`;
  const backend = await database(env);
  if (!backend) {
    memory.set(key, (memory.get(key) ?? 0) + 1);
    for (const k of memory.keys()) if (k < before) memory.delete(k);
    return;
  }
  const { db, d1 } = backend;
  try {
    // Atomic UPSERT: concurrent requests do not read-modify-write a JSON blob.
    const sql = "INSERT INTO site_settings (key,value,updated_at) VALUES (?, '1', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(site_settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at";
    const prune = "DELETE FROM site_settings WHERE key LIKE 'unsigned_bot_rejections:%' AND key < ?";
    if (d1) {
      await db.prepare(SITE_SETTINGS_TABLE_DDL).run();
      await db.prepare(sql).bind(key, now.toISOString()).run();
      await db.prepare(prune).bind(before).run();
    } else {
      db.exec(SITE_SETTINGS_TABLE_DDL);
      db.prepare(sql).run(key, now.toISOString());
      db.prepare(prune).run(before);
    }
  } finally { if (!d1) db.close(); }
}

export async function readUnsignedBotRejections(env: Env, now = new Date()) {
  const backend = await database(env);
  let rows: Array<{ key: string; value: string }>;
  if (!backend) rows = [...memory].map(([key, value]) => ({ key, value: String(value) }));
  else {
    const { db, d1 } = backend;
    try {
      const sql = "SELECT key,value FROM site_settings WHERE key LIKE 'unsigned_bot_rejections:%' AND key >= ? ORDER BY key DESC LIMIT 52";
      if (d1) {
        await db.prepare(SITE_SETTINGS_TABLE_DDL).run();
        rows = (await db.prepare(sql).bind(`${PREFIX}${cutoff(now)}`).all()).results;
      } else {
        db.exec(SITE_SETTINGS_TABLE_DDL);
        rows = db.prepare(sql).all(`${PREFIX}${cutoff(now)}`);
      }
    } finally { if (!d1) db.close(); }
  }
  const periods = new Map<string, { period: string; googlebot: number; bingbot: number; other: number; unknown: number }>();
  for (const { key, value } of rows) {
    const match = /^unsigned_bot_rejections:(\d{4}-(?:0[1-9]|1[0-2])):(googlebot|bingbot|other|unknown)$/.exec(key);
    if (!match || match[1] < cutoff(now)) continue;
    const entry = periods.get(match[1]) ?? { period: match[1], googlebot: 0, bingbot: 0, other: 0, unknown: 0 };
    entry[match[2] as Family] = Math.max(0, Number.parseInt(value, 10) || 0);
    periods.set(match[1], entry);
  }
  return { available: true, persistence: backend ? "database" : "process", periods: [...periods.values()].sort((a, b) => b.period.localeCompare(a.period)) };
}
