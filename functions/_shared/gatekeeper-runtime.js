// Local Trust Protocol Gatekeeper Runtime Orchestrator (Bloque 3).
// Compartido entre Cloudflare Pages Functions (functions/_middleware.js) y
// Node self-host (server/node-runtime.mjs -> functions/_middleware.js).
//
// Responsabilidades:
//   1. Resolucion fail-closed de PORTALESS_GATEKEEPER_MODE (off | shadow | enforce;
//      default: "off"; cualquier valor desconocido falla cerrado con 503).
//   2. Frontera unica de adaptador anfitrion (`createVeraTrustHostAdapter`) que
//      aisla las llamadas a `@verared/local-trust` y `@verared/reputation` para
//      facilitar el futuro repin a `@verared/* v0.1.0-rc.1`.
//   3. Admision pre-autenticacion conectada al Pre-Auth Egress Guard
//      (IP confiable, HMAC-SHA256, presupuestos acotados, single-flight, cache LRU).
//   4. Telemetria estructurada en `shadow` y `enforce` sin filtrar IPs crudas
//      ni secretos.

import {
  APPROVED_LIMITS,
  acquireIdentity,
  verifyHandoff,
} from "@verared/local-trust";
import {
  NEUTRAL,
  classifyLevel,
  projectSvri,
  runReputationCase,
} from "@verared/reputation";
import { ResolutionBudget } from "@verared/trust-layer/net";
import {
  GatekeeperConfigError,
  extractTrustedClientIp,
  hashClientIp,
  normalizeOriginKey,
  rateLimitedEgressResponse,
  resolveTrustedProxyMode,
  sharedPreAuthEgressGuard,
} from "./preauth-egress-guard.js";

export const VALID_GATEKEEPER_MODES = Object.freeze(["off", "shadow", "enforce"]);

/** Instancia compartida de ResolutionBudget entre Gatekeeper y @verared/trust-layer. */
export const sharedResolutionBudget = new ResolutionBudget();

/**
 * Construye el resolver `TrustedIngress` del host para `@verared/trust-layer@0.1.0-rc.1`.
 * Devuelve `undefined` cuando no hay ingress confiable configurado (fail-closed:
 * `trustedIngressStatus(undefined)` reporta `{ configured: false, source: "unconfigured" }`).
 */
export function createHostTrustedIngress(env = {}) {
  const hasExplicitProxy =
    typeof env?.PORTALESS_TRUSTED_PROXY === "string" &&
    env.PORTALESS_TRUSTED_PROXY.trim() !== "" &&
    env.PORTALESS_TRUSTED_PROXY.trim().toLowerCase() !== "none";
  const isNodeRuntime = env?.__PORTALESS_RUNTIME === "node";
  const isTrustedCloudflare = env?.PORTALESS_TRUSTED_CLOUDFLARE_INGRESS === "true";

  if (!hasExplicitProxy && !isNodeRuntime && !isTrustedCloudflare) {
    return undefined;
  }

  const effectiveEnv =
    !hasExplicitProxy && isTrustedCloudflare
      ? { ...env, PORTALESS_TRUSTED_PROXY: "cloudflare" }
      : env;

  return {
    resolveClientIp(request) {
      return extractTrustedClientIp(request, effectiveEnv);
    },
  };
}

/**
 * Construye las opciones de `verifyWebBotAuthRequest` para `@verared/trust-layer@0.1.0-rc.1`:
 * inyecta `createNonceStore` sin `env`, `reservedOrigins`, `TrustedIngress` del host
 * y una instancia compartida de `ResolutionBudget`.
 */
export function buildWebBotAuthVerifyOptions(
  env = {},
  { createNonceStore, directoryFetcher, budget = sharedResolutionBudget } = {}
) {
  const reservedOrigins =
    typeof env?.PORTALESS_WBA_RESERVED_ORIGINS === "string"
      ? env.PORTALESS_WBA_RESERVED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean)
      : undefined;

  const budgetEnabled = env?.PORTALESS_RESOLUTION_BUDGET_ENABLED === "true";
  const secret =
    (typeof env?.PORTALESS_RESOLUTION_BUDGET_SECRET === "string" && env.PORTALESS_RESOLUTION_BUDGET_SECRET.trim()) ||
    (budgetEnabled ? "" : (typeof env?.PORTALESS_IP_HMAC_SECRET === "string" ? env.PORTALESS_IP_HMAC_SECRET.trim() : ""));
  const previousSecret =
    typeof env?.PORTALESS_RESOLUTION_BUDGET_PREVIOUS_SECRET === "string" &&
    env.PORTALESS_RESOLUTION_BUDGET_PREVIOUS_SECRET.trim()
      ? env.PORTALESS_RESOLUTION_BUDGET_PREVIOUS_SECRET.trim()
      : undefined;

  const resolutionBudget =
    (budgetEnabled && secret)
      ? {
          secret,
          previousSecret,
          ingress: createHostTrustedIngress(env),
          budget: env?.__PORTALESS_RESOLUTION_BUDGET ?? budget,
        }
      : undefined;

  return {
    createNonceStore: typeof createNonceStore === "function" ? () => createNonceStore(env) : undefined,
    reservedOrigins,
    resolutionBudget,
    directoryFetcher: directoryFetcher ?? env?.__PORTALESS_DIRECTORY_FETCHER,
  };
}

/**
 * Resuelve PORTALESS_GATEKEEPER_MODE con default conservador "off" y fail-closed
 * ante cualquier valor desconocido (nunca degrada silenciosamente a "off").
 */
export function resolveGatekeeperMode(env = {}) {
  const raw = env?.PORTALESS_GATEKEEPER_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === "") return "off";
  const normalized = String(raw).trim().toLowerCase();
  if (!VALID_GATEKEEPER_MODES.includes(normalized)) {
    throw new GatekeeperConfigError(
      "invalid_gatekeeper_mode",
      `PORTALESS_GATEKEEPER_MODE invalido: "${String(raw)}". Valores validos: ${VALID_GATEKEEPER_MODES.join(", ")}.`
    );
  }
  return normalized;
}

export function gatekeeperMisconfiguredResponse(err) {
  const reason = err instanceof GatekeeperConfigError ? err.reason : "invalid_gatekeeper_config";
  return new Response(
    JSON.stringify({
      error: "gatekeeper_misconfigured",
      reason,
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }
  );
}

export function gatekeeperDeniedResponse(reason, details = {}) {
  return new Response(
    JSON.stringify({
      error: "gatekeeper_denied",
      reason,
      ...(details.reputationLevel ? { reputation_level: details.reputationLevel } : {}),
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }
  );
}

/**
 * Emite un evento estructurado de telemetria del Gatekeeper.
 * Nunca incluye IPs crudas, cabeceras de autorizacion ni secretos.
 */
export function emitGatekeeperTelemetry(env, event) {
  const payload = {
    ts: new Date().toISOString(),
    ...event,
  };
  if (typeof env?.__PORTALESS_GATEKEEPER_SINK === "function") {
    try {
      env.__PORTALESS_GATEKEEPER_SINK(payload);
    } catch {
      // Telemetry sink errors must never crash request handling.
    }
    return payload;
  }
  if (env?.PORTALESS_GATEKEEPER_LOG !== "false") {
    console.info("[gatekeeper]", JSON.stringify(payload));
  }
  return payload;
}

/**
 * Extrae un origen/host destino normalizado para contabilidad de presupuestos
 * pre-autenticacion (desde Signature-Agent cuando existe, o desde la URL).
 */
export function targetOriginFromRequest(request, fallbackOrigin = "origin:unknown") {
  const sigAgent = request?.headers?.get?.("signature-agent");
  if (typeof sigAgent === "string" && sigAgent.trim()) {
    const cleaned = sigAgent.trim().replace(/^"+|"+$/g, "");
    return normalizeOriginKey(cleaned);
  }
  return normalizeOriginKey(fallbackOrigin);
}

/**
 * Frontera unica de adaptador anfitrion hacia los paquetes `@verared/*`.
 * Cuando el proyecto repinee a `@verared/* v0.1.0-rc.1`, cualquier ajuste de
 * firma o contrato de `@verared/local-trust` / `@verared/reputation` queda
 * aislado en esta funcion.
 */
export function createVeraTrustHostAdapter(env = {}) {
  return {
    packageBoundary: Object.freeze({
      identityPackage: "@verared/local-trust",
      reputationPackage: "@verared/reputation",
      limits: APPROVED_LIMITS,
    }),

    async resolveIdentity({ domain, readerDid, operatorKeyId, webBotAuth }) {
      if (typeof env?.__PORTALESS_GATEKEEPER_IDENTITY_RESOLVER === "function") {
        const custom = await env.__PORTALESS_GATEKEEPER_IDENTITY_RESOLVER({
          domain,
          readerDid,
          operatorKeyId,
          webBotAuth,
        });
        return {
          ok: Boolean(custom?.verified),
          verified: Boolean(custom?.verified),
          subject: custom?.subject ?? readerDid ?? operatorKeyId ?? "unknown",
          reason: custom?.reason ?? (custom?.verified ? "verified" : "identity_unverified"),
          evidence: custom?.evidence ?? null,
        };
      }

      // Camino real acotado hacia @verared/local-trust cuando el despliegue
      // configura explicitamente un endpoint DoH (sin egresos no configurados).
      if (typeof env?.PORTALESS_GATEKEEPER_DOH_URL === "string" && env.PORTALESS_GATEKEEPER_DOH_URL.trim() && domain) {
        try {
          const acquired = await acquireIdentity(
            { domain },
            {
              dohUrl: env.PORTALESS_GATEKEEPER_DOH_URL.trim(),
              limits: APPROVED_LIMITS,
            }
          );
          const handoff = await verifyHandoff(acquired);
          const verified = Boolean(handoff?.ok ?? handoff?.verified);
          return {
            ok: verified,
            verified,
            subject: readerDid ?? domain,
            reason: verified ? "ltp_identity_verified" : (handoff?.reason ?? "ltp_identity_unverified"),
            evidence: handoff ?? null,
          };
        } catch (err) {
          return {
            ok: false,
            verified: false,
            subject: readerDid ?? domain,
            reason: err?.code ?? err?.message ?? "ltp_identity_acquisition_failed",
            evidence: null,
          };
        }
      }

      // Sin DoH configurado: usa el resultado verificado de Web Bot Auth sin
      // disparar egresos DNS externos no autorizados.
      if (webBotAuth?.verified) {
        return {
          ok: true,
          verified: true,
          subject: readerDid ?? operatorKeyId ?? "unknown",
          reason: "web_bot_auth_verified",
          evidence: null,
        };
      }

      return {
        ok: false,
        verified: false,
        subject: readerDid ?? operatorKeyId ?? "unknown",
        reason: "identity_unverified",
        evidence: null,
      };
    },

    async evaluateReputation({ domain, readerDid, operatorKeyId, identity, webBotAuth, governed }) {
      if (typeof env?.__PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR === "function") {
        const custom = await env.__PORTALESS_GATEKEEPER_REPUTATION_EVALUATOR({
          domain,
          readerDid,
          operatorKeyId,
          identity,
          webBotAuth,
          governed,
        });
        const decision = custom?.decision === "deny" ? "deny" : "allow";
        return {
          ok: decision === "allow",
          decision,
          level: custom?.level ?? classifyLevel(typeof custom?.score === "number" ? custom.score : NEUTRAL),
          score: typeof custom?.score === "number" ? custom.score : NEUTRAL,
          reason: custom?.reason ?? (decision === "allow" ? "reputation_allowed" : "reputation_denied"),
        };
      }

      if (env?.__PORTALESS_GATEKEEPER_REPUTATION_CASE) {
        const evaluated = runReputationCase(env.__PORTALESS_GATEKEEPER_REPUTATION_CASE);
        const projected = evaluated?.svriInput ? projectSvri(evaluated.svriInput) : null;
        const score = typeof projected?.score === "number" ? projected.score : NEUTRAL;
        const level = projected?.level ?? classifyLevel(score);
        const decision = evaluated?.decision === "deny" ? "deny" : "allow";
        return {
          ok: decision === "allow",
          decision,
          level,
          score,
          reason: evaluated?.reason ?? (decision === "allow" ? "reputation_case_allowed" : "reputation_case_denied"),
        };
      }

      const level = classifyLevel(NEUTRAL);
      return {
        ok: true,
        decision: "allow",
        level,
        score: NEUTRAL,
        reason: "reputation_neutral_default",
      };
    },
  };
}

/**
 * Valida la configuracion del Gatekeeper para una peticion entrante y prepara
 * el hash HMAC-SHA256 de la IP confiable.
 * - En `off`: no exige secreto HMAC ni consume presupuestos.
 * - En `shadow` / `enforce`: valida `PORTALESS_TRUSTED_PROXY` y construye `ipHash`.
 * - En `enforce`: exige `PORTALESS_IP_HMAC_SECRET` (>= 16 chars) o devuelve `503`.
 */
export function resolveGatekeeperRequestContext(request, env = {}) {
  try {
    const mode = resolveGatekeeperMode(env);
    if (mode === "off") {
      return { ok: true, mode, ipHash: null, errorResponse: null };
    }
    resolveTrustedProxyMode(env);
    const rawIp = extractTrustedClientIp(request, env);
    const ipHash = hashClientIp(rawIp, env, { mode });
    return { ok: true, mode, ipHash, errorResponse: null };
  } catch (err) {
    return {
      ok: false,
      mode: "invalid",
      ipHash: null,
      errorResponse: gatekeeperMisconfiguredResponse(err),
    };
  }
}

/**
 * Compuerta de presupuesto pre-autenticacion ANTES de cualquier egreso
 * externo de verificacion de directorio/identidad.
 */
export function checkPreAuthEgressBudget({
  request,
  env = {},
  mode,
  ipHash,
  pathname,
  governed = false,
  origin,
  guard = env?.__PORTALESS_PREAUTH_GUARD ?? sharedPreAuthEgressGuard,
}) {
  if (mode === "off") {
    return { allowed: true, response: null };
  }
  const targetOrigin = origin ?? targetOriginFromRequest(request);
  const budget = guard.consumeBudget({ ipHash, origin: targetOrigin, env });
  if (budget.allowed) {
    return { allowed: true, response: null, targetOrigin };
  }

  emitGatekeeperTelemetry(env, {
    mode,
    phase: "preauth_egress",
    pathname,
    governed,
    ipHash,
    targetOrigin,
    wouldBlock: true,
    enforcedAction: mode === "enforce" ? "rate_limited" : "shadow_allow",
    reason: "egress_budget_exceeded",
    scope: budget.scope,
    retryAfterSeconds: budget.retryAfterSeconds,
  });

  if (mode === "enforce") {
    return {
      allowed: false,
      response: rateLimitedEgressResponse(budget.retryAfterSeconds, budget.scope),
      targetOrigin,
    };
  }

  return { allowed: true, response: null, targetOrigin };
}

/**
 * Evaluacion Gatekeeper post-firma (identidad + reputacion + decision/telemetria).
 * Solo debe invocarse cuando la firma Web Bot Auth ya fue verificada (`verified: true`);
 * las firmas invalidas o expiradas deben rechazarse con 401 antes de llegar aqui.
 */
export async function evaluateGatekeeper({
  request,
  env = {},
  mode,
  ipHash,
  pathname,
  governed = false,
  policyAccess = "allow",
  webBotAuth,
  operatorKeyId,
  readerDid,
  readerHost,
  budgetAlreadyCharged = false,
  guard = env?.__PORTALESS_PREAUTH_GUARD ?? sharedPreAuthEgressGuard,
  adapter = createVeraTrustHostAdapter(env),
}) {
  if (mode === "off") {
    return { mode: "off", allow: true, decision: "bypass", response: null };
  }

  const targetOrigin = targetOriginFromRequest(request, readerHost || operatorKeyId || "origin:unknown");
  const cacheKey = `ltp:id:${readerDid || operatorKeyId || targetOrigin}`;

  const resolved = await guard.resolveWithCoalescing(
    cacheKey,
    () =>
      adapter.resolveIdentity({
        domain: readerHost,
        readerDid,
        operatorKeyId,
        webBotAuth,
      }),
    {
      ipHash,
      origin: targetOrigin,
      env,
      budgetAlreadyCharged,
      isPositive: (val) => Boolean(val && val.verified === true),
    }
  );

  if (!resolved.allowed) {
    const telemetry = emitGatekeeperTelemetry(env, {
      mode,
      phase: "identity_lookup",
      pathname,
      governed,
      policyAccess,
      ipHash,
      operatorKeyId,
      readerDid: readerDid ?? null,
      wouldBlock: true,
      enforcedAction: mode === "enforce" ? "rate_limited" : "shadow_allow",
      reason: "egress_budget_exceeded",
      scope: resolved.scope,
      retryAfterSeconds: resolved.retryAfterSeconds,
    });
    if (mode === "enforce") {
      return {
        mode,
        allow: false,
        decision: "rate_limited",
        telemetry,
        response: rateLimitedEgressResponse(resolved.retryAfterSeconds, resolved.scope),
      };
    }
    return {
      mode,
      allow: true,
      decision: "shadow_would_rate_limit",
      telemetry,
      response: null,
    };
  }

  const identity = resolved.value;
  const reputation = await adapter.evaluateReputation({
    domain: readerHost,
    readerDid,
    operatorKeyId,
    identity,
    webBotAuth,
    governed,
  });

  const wouldDeny = !identity?.verified || reputation?.decision === "deny";
  const reason = !identity?.verified
    ? (identity?.reason || "identity_unverified")
    : reputation?.decision === "deny"
      ? (reputation?.reason || "reputation_denied")
      : "allowed";

  const telemetry = emitGatekeeperTelemetry(env, {
    mode,
    phase: "decision",
    pathname,
    governed,
    policyAccess,
    ipHash,
    operatorKeyId,
    readerDid: readerDid ?? null,
    identityVerified: Boolean(identity?.verified),
    identityCached: Boolean(resolved.cached),
    identityCoalesced: Boolean(resolved.coalesced),
    reputationDecision: reputation?.decision ?? "allow",
    reputationLevel: reputation?.level ?? null,
    wouldBlock: wouldDeny,
    enforcedAction: mode === "enforce" && wouldDeny ? "deny" : "allow",
    reason,
  });

  if (mode === "enforce" && wouldDeny) {
    return {
      mode,
      allow: false,
      decision: "deny",
      identity,
      reputation,
      telemetry,
      response: gatekeeperDeniedResponse(reason, { reputationLevel: reputation?.level }),
    };
  }

  return {
    mode,
    allow: true,
    decision: wouldDeny ? "shadow_would_deny" : "allow",
    identity,
    reputation,
    telemetry,
    response: null,
  };
}
