import { SITE_SETTINGS_TABLE_DDL } from "../../../dashboard/src/site-settings/site-settings-store";
import { openSqlite } from "../../../sqlite-driver/src/open";

export const BOT_FAMILIES = ["googlebot", "bingbot", "other", "unknown"] as const;
type Family = typeof BOT_FAMILIES[number];
type Env = { DB?: any; PORTALESS_SQLITE_PATH?: string };
const PREFIX = "unsigned_bot_rejections:";
const memory = new Map<string, number>();
export const BOT_METRICS_FLUSH_MS = 10_000;
interface Buffer {
  env: Env;
  pending: Map<string, number>;
  latest: Date;
  scheduled?: Promise<void>;
  flushing?: Promise<void>;
}
const sqliteBuffers = new Map<string, Buffer>();
const d1Buffers = new WeakMap<object, Buffer>();

function bufferFor(env: Env): Buffer {
  const existing = env.DB ? d1Buffers.get(env.DB) : sqliteBuffers.get(env.PORTALESS_SQLITE_PATH!);
  if (existing) return existing;
  const buffer: Buffer = { env, pending: new Map(), latest: new Date(0) };
  if (env.DB) d1Buffers.set(env.DB, buffer);
  else sqliteBuffers.set(env.PORTALESS_SQLITE_PATH!, buffer);
  return buffer;
}

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

export async function recordUnsignedBotRejection(
  env: Env, ua: string | null, now = new Date(), waitUntil?: (task: Promise<unknown>) => void,
): Promise<void> {
  // Never persist raw UA, IP, URL, signature, key, or identity; only 4 buckets/month.
  const key = `${PREFIX}${now.toISOString().slice(0, 7)}:${unsignedBotFamily(ua)}`;
  const before = `${PREFIX}${cutoff(now)}`;
  if (!env?.DB && !env?.PORTALESS_SQLITE_PATH) {
    memory.set(key, (memory.get(key) ?? 0) + 1);
    for (const k of memory.keys()) if (k < before) memory.delete(k);
    return;
  }
  const buffer = bufferFor(env);
  if (now > buffer.latest) buffer.latest = now;
  buffer.pending.set(key, (buffer.pending.get(key) ?? 0) + 1);
  for (const k of buffer.pending.keys()) if (k < `${PREFIX}${cutoff(buffer.latest)}`) buffer.pending.delete(k);
  schedule(buffer, waitUntil);
}

function schedule(buffer: Buffer, waitUntil?: (task: Promise<unknown>) => void): void {
  if (!buffer.scheduled) {
    const delay = new Promise<void>((done) => {
      const timer = setTimeout(done, BOT_METRICS_FLUSH_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    buffer.scheduled = delay.then(() => flush(buffer)).catch(() => {
      console.warn("[trust-layer] aggregate flush failed; buffered counts may be lost");
    }).finally(() => {
      buffer.scheduled = undefined;
      if (buffer.pending.size) schedule(buffer, waitUntil);
      else if (!buffer.env.DB && sqliteBuffers.get(buffer.env.PORTALESS_SQLITE_PATH!) === buffer) {
        sqliteBuffers.delete(buffer.env.PORTALESS_SQLITE_PATH!);
      }
    });
  }
  // Workers can otherwise discard background work when the response completes.
  // Node timers are unref'd; neither path delays the existing 403 response.
  waitUntil?.(buffer.scheduled);
}

async function flush(buffer: Buffer): Promise<void> {
  if (buffer.flushing) return buffer.flushing;
  if (!buffer.pending.size) return;
  const batch = buffer.pending;
  buffer.pending = new Map();
  const latest = buffer.latest;
  const task = persist(buffer.env, batch, latest);
  buffer.flushing = task;
  try { await task; }
  finally { buffer.flushing = undefined; }
}

async function persist(env: Env, batch: Map<string, number>, now: Date): Promise<void> {
  const backend = await database(env);
  if (!backend) return;
  const { db, d1 } = backend;
  try {
    // At most one UPSERT per period/family per flush, not one per rejection.
    const sql = "INSERT INTO site_settings (key,value,updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(site_settings.value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT), updated_at = excluded.updated_at";
    const prune = "DELETE FROM site_settings WHERE key LIKE 'unsigned_bot_rejections:%' AND key < ?";
    const before = `${PREFIX}${cutoff(now)}`;
    if (d1) {
      await db.prepare(SITE_SETTINGS_TABLE_DDL).run();
      await db.batch([
        ...[...batch].map(([key, count]) => db.prepare(sql).bind(key, String(count), now.toISOString())),
        db.prepare(prune).bind(before),
      ]);
    } else {
      db.exec(SITE_SETTINGS_TABLE_DDL);
      db.transaction(() => {
        const upsert = db.prepare(sql);
        for (const [key, count] of batch) upsert.run(key, String(count), now.toISOString());
        db.prepare(prune).run(before);
      })();
    }
  } finally { if (!d1) db.close(); }
}

/** Test-only drain; admin reads never force attacker-controlled writes. */
export async function __flushUnsignedBotMetricsForTests(env: Env): Promise<void> {
  if (env.DB || env.PORTALESS_SQLITE_PATH) await flush(bufferFor(env));
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
  return { available: true, approximate: true, flushIntervalSeconds: BOT_METRICS_FLUSH_MS / 1000,
    persistence: backend ? "database" : "process", periods: [...periods.values()].sort((a, b) => b.period.localeCompare(a.period)) };
}
