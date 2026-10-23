// Cloudflare Pages Function - middleware global del Trust Layer. Corre igual
// en self-host: server/node-runtime.mjs carga los _middleware.js de functions/.
// ACTUALIZADO v0.0.6: ledger via store-factory.ts (D1/SQLite), no memoria.
//
// El verificador es webbotauth/verify.ts (exportado por index.ts), sin
// dependencias fuera de WebCrypto.
//
// PR H: correccion de PR C. PR C cambio la lectura del keyId a
// result.agentKeyId diciendo que result.keyRecord.keyId no existia. Era falso
// para este verificador: verify.ts devolvia keyRecord, no agentKeyId, y desde
// ese cambio todo agente verificado quedaba como "unknown" en el ledger.
// verify.ts ahora devuelve los dos campos y aca se leen ambos.
//
// PR C: las rutas de descubrimiento (robots.txt, llms.txt, sitemap.xml,
// /.well-known/*, /blog/*.md) pasan sin firma. Ver public-bot-routes.ts.
//
// PR H: politica "charge" con proveedores pay-per-crawl. Solo cobra si el
// manifiesto declara settlement_provider Y hay una activacion verificada en
// la base (billing/pay-per-crawl/resolve.ts). Con cloudflare-pay-per-crawl,
// Cloudflare cobra y el origen solo agrega crawler-price; el ledger registra
// charged:false porque el origen no sabe si el crawler pago. Sin proveedor
// activo, "charge" responde 402 settlement:not_available y nunca registra cobro.
//
// PR C: la politica sale del manifiesto publicado (env.ASSETS), no de
// defaultContentPolicy(). Ver load-policy.ts.
//
// APW v1.2 (B9): el resultado de la verificacion queda en
// context.data.webBotAuth para que los handlers (GET /trust/:siteId) no
// vuelvan a verificar: una segunda verificacion consumiria el nonce otra vez
// y responderia nonce_replayed.
//
// ERRATA E-9: con la firma verificada se guarda en el ledger el readerDid
// CANDIDATO (did:apw:<host de Signature-Agent>). Sin llamadas de red: la
// comprobacion contra el TXT del lector la hace el emisor de reader_conduct.
//
// ERRATA E-10 (emision automatica): despues de registrar un acceso con
// readerDid, el middleware dispara en background la emision idempotente de
// reader_conduct del periodo actual (reader-conduct-auto.ts). Opt-out con
// APW_AUTO_EMIT_CONDUCT=false. En Cloudflare Pages corre via context.waitUntil;
// en self-host (sin waitUntil) se lanza sin esperar y sus errores se tragan.

import {
  verifyWebBotAuthRequest,
  recordAgentAccess,
} from "../packages/trust-layer/src/index.ts";
import { createUsageLedgerStore } from "../packages/trust-layer/src/ledger/store-factory.ts";
import { recordUnsignedBotRejection } from "../packages/trust-layer/src/ledger/unsigned-bot-metrics.ts";
import { isPublicBotRoute } from "../packages/trust-layer/src/policy/public-bot-routes.ts";
import { loadContentPolicy } from "../packages/trust-layer/src/policy/load-policy.ts";
import { createAgentAccessPolicyStore } from "../packages/trust-layer/src/policy/agent-access-store.ts";
import { resolveLegacyRedirect } from "../src/lib/routes.ts";
import { migrationStatus } from "../packages/persistence-migrations/src/gate.ts";
import { resolvePayPerCrawl } from "../packages/trust-layer/src/billing/pay-per-crawl/resolve.ts";
import { createSettlementActivationStore } from "../packages/trust-layer/src/billing/pay-per-crawl/activation-store.ts";
import { readerHostFromOperator } from "../packages/apw-resolver/src/scoring/reader-identity.ts";
import { resolveApwManifest } from "../packages/apw-resolver/src/index.ts";
import { createSiteIdentityStore, createAttestationLogStore, createReaderConductJtiStore } from "../packages/apw-resolver/src/did-apw/store-factory.ts";
import { maybeAutoEmitReaderConduct } from "../packages/apw-resolver/src/scoring/reader-conduct-auto.ts";

function looksLikeAutomatedAgent(request) {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|gpt|claude|scrapy|python-requests/i.test(ua);
}

// Throttle en memoria por isolate: como maximo un intento de emision por
// agente y periodo cada 6 horas. El jti determinista hace el resto: si algo
// ya se emitio, el siguiente intento (en otro isolate o a mano) es un solo
// SELECT y no duplica.
const AUTO_EMIT_RETRY_MS = 6 * 60 * 60 * 1000;
const autoEmitLastAttempt = new Map();

function scheduleAutoEmit(context, env, operatorKeyId) {
  if (env.APW_AUTO_EMIT_CONDUCT === "false") return;
  if (!operatorKeyId || operatorKeyId === "unknown" || operatorKeyId === "unverified") return;
  const now = Date.now();
  const period = new Date(now).toISOString().slice(0, 7);
  const key = `${operatorKeyId}|${period}`;
  const last = autoEmitLastAttempt.get(key);
  if (last !== undefined && now - last < AUTO_EMIT_RETRY_MS) return;
  autoEmitLastAttempt.set(key, now);
  if (autoEmitLastAttempt.size > 5000) {
    const oldest = autoEmitLastAttempt.keys().next().value;
    autoEmitLastAttempt.delete(oldest);
  }

  const task = (async () => {
    try {
      const deps = {
        identity: await createSiteIdentityStore(env),
        log: await createAttestationLogStore(env),
        ledger: await createUsageLedgerStore(env),
        jtiStore: await createReaderConductJtiStore(env),
        resolveTxtKey: async (host) => {
          const r = await resolveApwManifest(host);
          return r.resolved && r.manifest?.k ? r.manifest.k : null;
        },
        nowMs: now,
      };
      await maybeAutoEmitReaderConduct(deps, operatorKeyId);
    } catch (err) {
      console.warn("[trust-layer] auto reader_conduct fallo:", err?.message ?? err);
    }
  })();

  if (typeof context.waitUntil === "function") context.waitUntil(task);
  // self-host: el runtime no expone waitUntil; el task sigue su curso solo.
}

const MIGRATION_STATUS_TTL_MS = 10_000;
let migrationStatusCache = new Map();
let migrationStatusInflight = new Map();
let migrationDbIds = new WeakMap();
let nextMigrationDbId = 1;

function migrationCacheKey(env) {
  if (env.DB && (typeof env.DB === "object" || typeof env.DB === "function")) {
    let id = migrationDbIds.get(env.DB);
    if (!id) {
      id = nextMigrationDbId++;
      migrationDbIds.set(env.DB, id);
    }
    return `d1:${id}`;
  }
  if (env.PORTALESS_SQLITE_PATH) return `sqlite:${env.PORTALESS_SQLITE_PATH}`;
  return "static";
}

/** Solo para tests: limpia la cache del gate entre escenarios. */
export function __resetMigrationGateForTests() {
  migrationStatusCache.clear();
  migrationStatusInflight.clear();
  migrationDbIds = new WeakMap();
  nextMigrationDbId = 1;
}

/** Consulta concurrente cacheada; solo retiene status/error, nunca Response ni su body consumible. */
async function cachedMigrationStatus(env) {
  const key = migrationCacheKey(env);
  const now = Date.now();
  const cached = migrationStatusCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const inflight = migrationStatusInflight.get(key);
  if (inflight) return inflight;

  const check = migrationStatus(env)
    .then((status) => {
      const result = { status };
      // Timestamp only after the DB read completed successfully.
      migrationStatusCache.set(key, { expiresAt: Date.now() + MIGRATION_STATUS_TTL_MS, result });
      return result;
    })
    .catch((error) => ({ error }))
    .finally(() => migrationStatusInflight.delete(key));
  migrationStatusInflight.set(key, check);
  return check;
}

/** Gate de migraciones cacheado (10s). Cada invocación construye su propia Response. */
async function migrationsGate(env) {
  const result = await cachedMigrationStatus(env);
  if (result.error) {
    return new Response(
      JSON.stringify({ error: "migration_status_unavailable", message: "No se pudo verificar el estado de la base de datos." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const status = result.status;
  if (!status || (!status.pending && !status.newer)) return null;

  const code = status.newer
    ? "database_newer_than_code"
    : status.invalid
      ? "database_schema_invalid"
      : "pending_database_migrations";
  const detail = [...(status.schemaErrors ?? []), ...(status.ledgerErrors ?? [])];
  const message = status.newer
    ? `La base esta en schema v${status.dbVersion} y el codigo espera v${status.codeVersion}: actualiza el codigo antes de servir.`
    : detail.length
      ? `El esquema no cumple el contrato del codigo: ${detail.join(", ")}. Corre doctor/migrate y vuelve a verificar.`
      : `La base esta en schema v${status.dbVersion} y el codigo espera v${status.codeVersion}: corre las migraciones (self-host: npm run migrate; Cloudflare D1: npm run migrate:d1 -- --db <DB> --remote).`;
  return new Response(JSON.stringify({ error: code, message }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  // GATE de migraciones (fail-closed): si la base esta detras del codigo (o
  // adelante), 503 en vez de dejar que una columna ausente rompa una query a
  // mitad de camino. Cachea el estado 10s, no una Response/body consumible.
  const migrationsBlock = await migrationsGate(env);
  if (migrationsBlock) return migrationsBlock;
  // REDIRECTS de las URLs legadas (Fase 3): 301 en el punto de entrada comun.
  // El mapa es FIJO (src/lib/routes.ts, LEGACY_ROUTES) y no tiene open redirect:
  // matching por tabla, slug validado, query preservado. En GitHub Pages (sin
  // functions/) el build static emite las paginas meta-refresh equivalentes.
  const url = new URL(request.url);
  const basePath = (env.PORTALESS_BASE_PATH || "/").replace(/\/+$/, "");
  const baseMatch = basePath === "/" || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  const sitePath = baseMatch ? url.pathname.slice(basePath.length) || "/" : url.pathname;
  const legacyDestination = resolveLegacyRedirect(sitePath);
  if (legacyDestination) {
    // Relativo en vez de `${url.origin}`: Host manipulado no debe controlar
    // un 301 cachable hacia otro origen.
    return new Response(null, {
      status: 301,
      headers: { location: `${basePath}${legacyDestination}${url.search}` },
    });
  }
  if (env.ENABLE_TRUST_LAYER !== "true") return next();
  if (isPublicBotRoute(new URL(request.url).pathname)) return next();

  const ledgerStore = await createUsageLedgerStore(env);
  const hasSignature = request.headers.get("Signature-Agent") !== null;
  const automatedLooking = looksLikeAutomatedAgent(request);

  if (!hasSignature && !automatedLooking) return next();

  if (!hasSignature && automatedLooking) {
    try { await recordUnsignedBotRejection(env, request.headers.get("user-agent"), new Date(), context.waitUntil?.bind(context)); }
    catch { console.warn("[trust-layer] unsigned-bot aggregate unavailable"); }
    return new Response(JSON.stringify({
      error: "unsigned_automated_request",
      message: "Este sitio usa Portaless Trust Layer. Firma tus peticiones segun Web Bot Auth o respeta las politicas en /.well-known/portaless-content-policy.json",
      policy_url: `${new URL(request.url).origin}/.well-known/portaless-content-policy.json`,
    }), { status: 403, headers: { "content-type": "application/json" } });
  }

  const result = await verifyWebBotAuthRequest(request, {
    env,
    // Solo el runtime Node lo expone: resuelve y valida una IP y conecta a
    // ella (DNS pinning). En edge no existe y el verificador usa su default.
    directoryFetcher: env.__PORTALESS_DIRECTORY_FETCHER,
  });
  if (context.data && typeof context.data === "object") context.data.webBotAuth = result;
  if (!result.verified) {
    if (result.failureType === "directory_redirect_disabled") {
      return Response.json({ error: "directory_redirect_disabled", reason: result.reason }, {
        status: 401, headers: { "cache-control": "no-store" },
      });
    }
    // Directory load, a cached upstream failure and expired credentials are not
    // evidence of policy misconduct. Do not attribute them to an operator.
    if (result.failureType === "unavailable") {
      return Response.json({ error: "verification_unavailable", reason: result.reason }, {
        status: result.status ?? 503,
        headers: { "retry-after": String(result.retryAfterSeconds ?? 1), "cache-control": "no-store" },
      });
    }
    if (result.failureType === "expired") {
      return Response.json({ error: "signature_expired", reason: result.reason }, {
        status: 401, headers: { "cache-control": "no-store" },
      });
    }
    await recordAgentAccess(ledgerStore, { operatorKeyId: "unverified", charged: false, amountUsd: 0, policyViolation: true });
    return Response.json({ error: "verification_failed", reason: result.reason }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const origin = new URL(request.url).origin;
  // Precedencia store > asset > default (ROADMAP.md fase 12). El store es el
  // override que el dueno escribio desde /admin/agents; si no hay override se
  // lee el asset de siempre.
  const policyStore = await createAgentAccessPolicyStore(env);
  const policy = await loadContentPolicy(origin, env.ASSETS, policyStore);
  const rule = policy.policies.ai_input;

  const operatorKeyId = result.agentKeyId ?? result.keyRecord?.keyId ?? "unknown";
  const readerHost = readerHostFromOperator(result.keyRecord?.operator);
  const readerDid = readerHost ? `did:apw:${readerHost}` : undefined;

  if (rule.access === "block") {
    await recordAgentAccess(ledgerStore, { operatorKeyId, readerDid, charged: false, amountUsd: 0 });
    scheduleAutoEmit(context, env, operatorKeyId);
    return new Response(JSON.stringify({ error: "ai_input_blocked_by_policy" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  if (rule.access === "charge") {
    await recordAgentAccess(ledgerStore, { operatorKeyId, readerDid, charged: false, amountUsd: 0 });
    scheduleAutoEmit(context, env, operatorKeyId);
    const activationStore = await createSettlementActivationStore(env);
    const settled = await resolvePayPerCrawl({ policy, rule, request, next, store: activationStore });
    if (settled) return settled.response;
    return new Response(JSON.stringify({
      error: "payment_required",
      price_usd: rule.price_usd,
      unit: rule.unit,
      settlement: "not_available",
      message: "Este sitio cobra el acceso de agentes pero todavia no tiene un medio de pago verificable. No reintentes con un comprobante: no se acepta ninguno.",
      policy_url: `${origin}/.well-known/portaless-content-policy.json`,
    }), { status: 402, headers: { "content-type": "application/json" } });
  }

  // allow: el trafico libre tambien alimenta el ledger publico y la
  // emision automatica de reader_conduct (E-9/E-10). Sin esto el ledger
  // solo veia accesos bloqueados o cobrados.
  await recordAgentAccess(ledgerStore, { operatorKeyId, readerDid, charged: false, amountUsd: 0 });
  scheduleAutoEmit(context, env, operatorKeyId);
  return next();
}
