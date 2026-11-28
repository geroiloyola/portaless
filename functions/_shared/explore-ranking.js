// Pure ranking engine for GET /explore.json.
// Computes deterministic per-item scores from verified community_attestations
// and witness_observations rows without side effects or I/O.

const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const WILSON_Z = 1.96;

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Normalizes a target/route identifier so paths like "/pages/foo", "pages/foo",
 * "/pages/foo/", or "https://site.test/pages/foo/" map to the same canonical key.
 * Non-path identifiers (e.g. "did:apw:example.com", "default") are trimmed and lowercased.
 */
export function normalizeExploreKey(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return null;
    }
  }

  if (value.startsWith("/") || value.includes("/")) {
    const withLeading = value.startsWith("/") ? value : `/${value}`;
    const collapsed = withLeading.replace(/\/{2,}/g, "/");
    if (collapsed === "/") return "/";
    return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  }

  return value.toLowerCase();
}

/**
 * Lower bound of Wilson score confidence interval for Bernoulli parameter.
 * Ensures an item with 1/1 positive signals ranks below 20/21 or 50/50.
 */
export function wilsonLowerBound(positives, total, z = WILSON_Z) {
  if (!Number.isFinite(positives) || !Number.isFinite(total) || total <= 0) return 0;
  const clampedPos = Math.max(0, Math.min(positives, total));
  const p = clampedPos / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  const lower = (center - margin) / denom;
  return round4(Math.max(0, Math.min(1, lower)));
}

function parseTimestampMs(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Unix seconds vs milliseconds
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function utcDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function ensureBucket(map, key) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {
      topNet: 0,
      positives: 0,
      totalWeight: 0,
      signals: 0,
      witnessObservations: 0,
      witnesses: new Set(),
      issuers: new Set(),
      days: new Set(),
      minTs: Infinity,
      maxTs: -Infinity,
    };
    map.set(key, bucket);
  }
  return bucket;
}

function recordTimestamp(bucket, tsMs) {
  if (tsMs === null || !Number.isFinite(tsMs)) return;
  bucket.days.add(utcDayKey(tsMs));
  if (tsMs < bucket.minTs) bucket.minTs = tsMs;
  if (tsMs > bucket.maxTs) bucket.maxTs = tsMs;
}

/**
 * Computes deterministic ranking scores for /explore.json.
 *
 * @param {{
 *   attestations?: Array<{ iss?: string, site_id?: string, sub?: string, category?: string, val?: number, iat?: number, received_at?: string }>,
 *   observations?: Array<{ site_id?: string, subject_did?: string, witness_did?: string, observed_seq?: number, anchored_ts?: string, updated_at?: string }>,
 *   excludedKeys?: Iterable<string>,
 *   nowMs?: number,
 *   windowDays?: number,
 * }} input
 */
export function computeExploreRanking(input = {}) {
  const attestations = Array.isArray(input.attestations) ? input.attestations : [];
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const windowDays =
    Number.isFinite(input.windowDays) && input.windowDays > 0 ? input.windowDays : DEFAULT_WINDOW_DAYS;
  const windowStartMs = nowMs - windowDays * MS_PER_DAY;

  const excluded = new Set();
  if (input.excludedKeys) {
    for (const raw of input.excludedKeys) {
      const normalized = normalizeExploreKey(raw);
      if (normalized) excluded.add(normalized);
    }
  }

  const buckets = new Map();

  for (const row of attestations) {
    if (!row || typeof row !== "object") continue;
    const key = normalizeExploreKey(row.sub || row.site_id);
    if (!key || excluded.has(key)) continue;

    const val = Number(row.val);
    if (!Number.isFinite(val) || val < 1 || val > 5) continue;

    const isSpam = row.category === "spam_or_deceptive";
    const quality = isSpam ? (5 - val) / 4 : (val - 1) / 4;
    const net = isSpam ? (3 - val) / 2 : (val - 3) / 2;

    const tsMs = parseTimestampMs(row.iat ?? row.received_at);
    const inWindow = tsMs === null || tsMs >= windowStartMs;

    const bucket = ensureBucket(buckets, key);
    bucket.signals += 1;
    bucket.positives += quality;
    bucket.totalWeight += 1;
    // top weights recent window fully and older attestations at 0.5x
    bucket.topNet += inWindow ? net : net * 0.5;
    if (typeof row.iss === "string" && row.iss.trim()) {
      bucket.issuers.add(row.iss.trim());
    }
    recordTimestamp(bucket, tsMs);
  }

  for (const row of observations) {
    if (!row || typeof row !== "object") continue;
    const key = normalizeExploreKey(row.subject_did || row.site_id);
    if (!key || excluded.has(key)) continue;

    const tsMs = parseTimestampMs(row.anchored_ts ?? row.updated_at);
    const inWindow = tsMs === null || tsMs >= windowStartMs;

    const bucket = ensureBucket(buckets, key);
    bucket.signals += 1;
    bucket.witnessObservations += 1;
    bucket.positives += 1;
    bucket.totalWeight += 1;
    bucket.topNet += inWindow ? 1 : 0.5;
    if (typeof row.witness_did === "string" && row.witness_did.trim()) {
      bucket.witnesses.add(row.witness_did.trim());
    }
    recordTimestamp(bucket, tsMs);
  }

  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b));
  const items = {};

  for (const key of sortedKeys) {
    const b = buckets.get(key);
    if (!b || b.signals === 0) continue;

    const spanDays =
      Number.isFinite(b.minTs) && Number.isFinite(b.maxTs) && b.maxTs >= b.minTs
        ? (b.maxTs - b.minTs) / MS_PER_DAY
        : 0;

    const history = round4(
      b.days.size +
        Math.min(spanDays, windowDays) / 7 +
        b.witnesses.size * 0.5 +
        b.issuers.size * 0.25 +
        Math.log1p(b.witnessObservations)
    );

    items[key] = {
      top: round4(b.topNet),
      confidence: wilsonLowerBound(b.positives, b.totalWeight),
      history,
      signals: b.signals,
    };
  }

  const hasSignals = sortedKeys.length > 0;
  return {
    source: "node",
    generatedAt: new Date(nowMs).toISOString(),
    hasSignals,
    windowDays,
    items,
  };
}
