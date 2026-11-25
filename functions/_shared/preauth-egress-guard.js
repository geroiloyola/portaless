// Pre-Auth Admission & Egress Guard (Gatekeeper Bloque 1).
// Compartido entre Cloudflare Pages Functions (functions/_middleware.js) y
// Node self-host (server/node-runtime.mjs -> functions/_middleware.js).
//
// Responsabilidades:
//   1. Extraccion confiable de IP cliente segun PORTALESS_TRUSTED_PROXY
//      (cloudflare | forwarded | none; default fail-closed: "none").
//   2. Hash HMAC-SHA256 por despliegue (PORTALESS_IP_HMAC_SECRET). Nunca
//      almacena ni emite IPs crudas en claves, telemetria ni logs.
//   3. Presupuesto de egresos pre-autenticacion por ventana:
//      - por IP hasheada (PORTALESS_EGRESS_BUDGET_PER_IP)
//      - por origen/dominio objetivo (PORTALESS_EGRESS_BUDGET_PER_ORIGIN)
//      - global (PORTALESS_EGRESS_BUDGET_GLOBAL)
//   4. Coalescing single-flight por clave canonica + cache TTL acotada en
//      tamano (positivos y negativos cortos, eviccion LRU estricta).

import { createHmac, randomBytes } from "node:crypto";

export const VALID_TRUSTED_PROXY_MODES = Object.freeze(["none", "cloudflare", "forwarded"]);
export const DEFAULT_EGRESS_WINDOW_MS = 60_000;
export const DEFAULT_EGRESS_BUDGET_PER_IP = 30;
export const DEFAULT_EGRESS_BUDGET_PER_ORIGIN = 60;
export const DEFAULT_EGRESS_BUDGET_GLOBAL = 300;
export const DEFAULT_CACHE_MAX_ENTRIES = 512;
export const DEFAULT_POSITIVE_TTL_MS = 60_000;
export const DEFAULT_NEGATIVE_TTL_MS = 10_000;

const MIN_HMAC_SECRET_LENGTH = 16;
const PROCESS_EPHEMERAL_HMAC_SECRET = randomBytes(32).toString("hex");

// Header interno escrito exclusivamente por server/node-runtime.mjs tras
// validar PORTALESS_TRUSTED_PROXIES (nunca aceptado del cliente).
const NODE_INTERNAL_CLIENT_IP_HEADER = "x-portaless-client-ip";

export class GatekeeperConfigError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = "GatekeeperConfigError";
    this.reason = reason;
  }
}

function parsePositiveInt(raw, fallback, max = 1_000_000) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return fallback;
  return n;
}

/**
 * Resuelve PORTALESS_TRUSTED_PROXY con fail-closed ante valores desconocidos.
 * Default conservador: "none" (no confia en cabeceras proxy falsificables).
 */
export function resolveTrustedProxyMode(env = {}) {
  const raw = env?.PORTALESS_TRUSTED_PROXY;
  if (raw === undefined || raw === null || String(raw).trim() === "") return "none";
  const normalized = String(raw).trim().toLowerCase();
  if (!VALID_TRUSTED_PROXY_MODES.includes(normalized)) {
    throw new GatekeeperConfigError(
      "invalid_trusted_proxy_mode",
      `PORTALESS_TRUSTED_PROXY invalido: "${String(raw)}". Valores validos: ${VALID_TRUSTED_PROXY_MODES.join(", ")}.`
    );
  }
  return normalized;
}

function sanitizeIpCandidate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  // IPv4 o IPv6 literal basico sin espacios ni caracteres de control
  if (!/^[0-9a-fA-F:.]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extrae la IP cliente unicamente desde la fuente confiable configurada.
 * - "none": ignora CF-Connecting-IP y X-Forwarded-For; solo acepta el header
 *   interno del runtime Node cuando existe.
 * - "cloudflare": lee exclusivamente CF-Connecting-IP (ignora X-Forwarded-For).
 * - "forwarded": en Node prefiere el header ya validado por node-runtime.mjs;
 *   en otros entornos toma el primer hop de X-Forwarded-For (ignora CF-Connecting-IP).
 */
export function extractTrustedClientIp(request, env = {}) {
  const mode = resolveTrustedProxyMode(env);
  const headers = request?.headers;
  if (!headers || typeof headers.get !== "function") return null;

  if (mode === "cloudflare") {
    return sanitizeIpCandidate(headers.get("cf-connecting-ip"));
  }

  if (mode === "forwarded") {
    if (env?.__PORTALESS_RUNTIME === "node") {
      const internal = sanitizeIpCandidate(headers.get(NODE_INTERNAL_CLIENT_IP_HEADER));
      if (internal) return internal;
    }
    const xff = headers.get("x-forwarded-for");
    if (typeof xff === "string" && xff.trim()) {
      const first = xff.split(",")[0];
      return sanitizeIpCandidate(first);
    }
    return null;
  }

  // mode === "none": nunca confiar en CF-Connecting-IP ni X-Forwarded-For.
  if (env?.__PORTALESS_RUNTIME === "node") {
    return sanitizeIpCandidate(headers.get(NODE_INTERNAL_CLIENT_IP_HEADER));
  }
  return null;
}

/**
 * Hashea la IP cliente con HMAC-SHA256 usando PORTALESS_IP_HMAC_SECRET.
 * En modo "enforce" exige secreto explicito (>= 16 chars) y falla cerrado si
 * falta. En "shadow"/"off" usa un secreto efimero seguro por proceso.
 * Si no hay IP confiable disponible, usa el bucket anonimo "ip:missing".
 */
export function hashClientIp(rawIp, env = {}, { mode = "shadow" } = {}) {
  const configuredSecret =
    typeof env?.PORTALESS_IP_HMAC_SECRET === "string" ? env.PORTALESS_IP_HMAC_SECRET.trim() : "";

  if (mode === "enforce" && configuredSecret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new GatekeeperConfigError(
      "missing_ip_hmac_secret",
      "PORTALESS_IP_HMAC_SECRET (>= 16 caracteres) es obligatorio cuando PORTALESS_GATEKEEPER_MODE=enforce."
    );
  }

  if (!rawIp) return "ip:missing";
  const secret = configuredSecret.length >= MIN_HMAC_SECRET_LENGTH
    ? configuredSecret
    : PROCESS_EPHEMERAL_HMAC_SECRET;
  const digest = createHmac("sha256", secret).update(rawIp).digest("hex");
  return `ip:${digest}`;
}

export function normalizeOriginKey(originOrHost) {
  if (typeof originOrHost !== "string" || !originOrHost.trim()) return "origin:unknown";
  const trimmed = originOrHost.trim().toLowerCase();
  try {
    if (trimmed.includes("://")) {
      const u = new URL(trimmed);
      return `origin:${u.host.toLowerCase()}`;
    }
  } catch {
    // fallback to host normalization below
  }
  return `origin:${trimmed.replace(/\/.*$/, "")}`;
}

export function resolveEgressBudgetLimits(env = {}) {
  return {
    perIp: parsePositiveInt(env?.PORTALESS_EGRESS_BUDGET_PER_IP, DEFAULT_EGRESS_BUDGET_PER_IP),
    perOrigin: parsePositiveInt(env?.PORTALESS_EGRESS_BUDGET_PER_ORIGIN, DEFAULT_EGRESS_BUDGET_PER_ORIGIN),
    global: parsePositiveInt(env?.PORTALESS_EGRESS_BUDGET_GLOBAL, DEFAULT_EGRESS_BUDGET_GLOBAL),
    windowMs: parsePositiveInt(env?.PORTALESS_EGRESS_WINDOW_MS, DEFAULT_EGRESS_WINDOW_MS, 3_600_000),
  };
}

/**
 * Crea una instancia aislada del Pre-Auth Egress Guard:
 *   - presupuestos por ventana (per-IP, per-origin, global),
 *   - single-flight coalescing por clave canonica,
 *   - cache TTL acotada en tamano con eviccion LRU (positivos y negativos).
 */
export function createPreAuthEgressGuard(options = {}) {
  const maxEntries = parsePositiveInt(options.maxEntries, DEFAULT_CACHE_MAX_ENTRIES, 100_000);
  const defaultPositiveTtlMs = parsePositiveInt(options.positiveTtlMs, DEFAULT_POSITIVE_TTL_MS, 3_600_000);
  const defaultNegativeTtlMs = parsePositiveInt(options.negativeTtlMs, DEFAULT_NEGATIVE_TTL_MS, 600_000);
  const maxBudgetKeys = parsePositiveInt(options.maxBudgetKeys, 10_000, 100_000);

  /** @type {Map<string, { windowStart: number, count: number }>} */
  const buckets = new Map();
  /** @type {Map<string, { value: any, ok: boolean, expiresAt: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<{ value: any, ok: boolean }>>} */
  const inflight = new Map();

  function pruneExpiredBuckets(windowStart) {
    if (buckets.size <= maxBudgetKeys) return;
    for (const [k, entry] of buckets) {
      if (entry.windowStart < windowStart) buckets.delete(k);
    }
    while (buckets.size > maxBudgetKeys) {
      const oldest = buckets.keys().next().value;
      buckets.delete(oldest);
    }
  }

  function currentCount(key, windowStart) {
    const entry = buckets.get(key);
    if (!entry || entry.windowStart !== windowStart) return 0;
    return entry.count;
  }

  function bump(key, windowStart) {
    const entry = buckets.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      buckets.set(key, { windowStart, count: 1 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  function retryAfterSeconds(windowStart, windowMs, now) {
    return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  }

  /**
   * Evalua y consume 1 unidad de presupuesto de egreso de forma atomica:
   * si cualquiera de los 3 topes (ip, origin, global) ya esta agotado,
   * devuelve { allowed: false, scope, retryAfterSeconds } sin incrementar
   * los otros contadores.
   */
  function consumeBudget({ ipHash, origin, env = {}, now = Date.now(), limits: overrideLimits } = {}) {
    const limits = overrideLimits ?? resolveEgressBudgetLimits(env);
    const windowStart = Math.floor(now / limits.windowMs) * limits.windowMs;
    pruneExpiredBuckets(windowStart);

    const ipKey = `b:${ipHash || "ip:missing"}`;
    const originKey = `b:${normalizeOriginKey(origin)}`;
    const globalKey = "b:global";

    if (currentCount(ipKey, windowStart) >= limits.perIp) {
      return {
        allowed: false,
        scope: "ip",
        retryAfterSeconds: retryAfterSeconds(windowStart, limits.windowMs, now),
      };
    }
    if (currentCount(originKey, windowStart) >= limits.perOrigin) {
      return {
        allowed: false,
        scope: "origin",
        retryAfterSeconds: retryAfterSeconds(windowStart, limits.windowMs, now),
      };
    }
    if (currentCount(globalKey, windowStart) >= limits.global) {
      return {
        allowed: false,
        scope: "global",
        retryAfterSeconds: retryAfterSeconds(windowStart, limits.windowMs, now),
      };
    }

    const ipCount = bump(ipKey, windowStart);
    const originCount = bump(originKey, windowStart);
    const globalCount = bump(globalKey, windowStart);
    return {
      allowed: true,
      counts: { ip: ipCount, origin: originCount, global: globalCount },
      limits,
    };
  }

  function getCached(cacheKey, now = Date.now()) {
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      cache.delete(cacheKey);
      return null;
    }
    // LRU touch
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    return entry;
  }

  function setCached(cacheKey, value, ok, ttlMs, now = Date.now()) {
    if (cache.has(cacheKey)) cache.delete(cacheKey);
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { value, ok, expiresAt: now + ttlMs });
  }

  /**
   * Resuelve `cacheKey` con:
   *   1. Cache TTL acotada (no consume presupuesto si acierta).
   *   2. Coalescing single-flight (N peticiones concurrentes => 1 sola llamada
   *      a `fetcher`, consumiendo 1 sola unidad de presupuesto).
   *   3. Chequeo de presupuesto ANTES de disparar `fetcher`.
   */
  async function resolveWithCoalescing(
    cacheKey,
    fetcher,
    {
      ipHash,
      origin,
      env = {},
      now = Date.now(),
      limits,
      positiveTtlMs = defaultPositiveTtlMs,
      negativeTtlMs = defaultNegativeTtlMs,
      budgetAlreadyCharged = false,
      isPositive = (val) => Boolean(val && val.ok !== false && val.verified !== false),
    } = {}
  ) {
    const cached = getCached(cacheKey, now);
    if (cached) {
      return {
        allowed: true,
        cached: true,
        coalesced: false,
        ok: cached.ok,
        value: cached.value,
      };
    }

    const existing = inflight.get(cacheKey);
    if (existing) {
      const settled = await existing;
      return {
        allowed: true,
        cached: false,
        coalesced: true,
        ok: settled.ok,
        value: settled.value,
      };
    }

    if (!budgetAlreadyCharged) {
      const budget = consumeBudget({ ipHash, origin, env, now, limits });
      if (!budget.allowed) {
        return {
          allowed: false,
          cached: false,
          coalesced: false,
          scope: budget.scope,
          retryAfterSeconds: budget.retryAfterSeconds,
        };
      }
    }

    const task = (async () => {
      try {
        const value = await fetcher();
        const ok = Boolean(isPositive(value));
        setCached(cacheKey, value, ok, ok ? positiveTtlMs : negativeTtlMs, Date.now());
        return { value, ok };
      } catch (error) {
        const negative = { ok: false, error: error?.message || "egress_lookup_failed" };
        setCached(cacheKey, negative, false, negativeTtlMs, Date.now());
        return { value: negative, ok: false };
      } finally {
        inflight.delete(cacheKey);
      }
    })();

    inflight.set(cacheKey, task);
    const settled = await task;
    return {
      allowed: true,
      cached: false,
      coalesced: false,
      ok: settled.ok,
      value: settled.value,
    };
  }

  function stats() {
    return {
      cacheSize: cache.size,
      maxEntries,
      inflightSize: inflight.size,
      budgetKeys: [...buckets.keys()],
    };
  }

  function reset() {
    buckets.clear();
    cache.clear();
    inflight.clear();
  }

  return {
    consumeBudget,
    resolveWithCoalescing,
    stats,
    reset,
  };
}

export const sharedPreAuthEgressGuard = createPreAuthEgressGuard();

export function rateLimitedEgressResponse(retryAfterSeconds, scope) {
  return new Response(
    JSON.stringify({
      error: "egress_budget_exceeded",
      scope,
      retry_after_seconds: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, retryAfterSeconds)),
      },
    }
  );
}
