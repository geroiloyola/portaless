// GET /admin/api/gatekeeper-status
// Devuelve el estado de configuracion en solo lectura del Local Trust Protocol
// Gatekeeper y de PORTALESS_TRUSTED_PROXY para el panel /admin/security.
// Nunca expone secretos (solo indica si PORTALESS_IP_HMAC_SECRET cumple el minimo).

import { resolveGatekeeperMode } from "../../_shared/gatekeeper-runtime.js";
import {
  GatekeeperConfigError,
  resolveEgressBudgetLimits,
  resolveTrustedProxyMode,
} from "../../_shared/preauth-egress-guard.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function countGovernedPaths(env = {}) {
  const raw = env?.PORTALESS_GOVERNED_PATHS;
  if (typeof raw !== "string" || !raw.trim()) return 0;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export async function onRequestGet(context) {
  const { data, env = {} } = context;
  if (!data?.user) {
    return json({ ok: false, error: "unauthenticated" }, 401);
  }

  let mode = "off";
  let modeError = null;
  try {
    mode = resolveGatekeeperMode(env);
  } catch (err) {
    mode = "invalid";
    modeError = err instanceof GatekeeperConfigError ? err.reason : "invalid_gatekeeper_mode";
  }

  let trustedProxy = "none";
  let proxyError = null;
  try {
    trustedProxy = resolveTrustedProxyMode(env);
  } catch (err) {
    trustedProxy = "invalid";
    proxyError = err instanceof GatekeeperConfigError ? err.reason : "invalid_trusted_proxy_mode";
  }

  const rawSecret =
    typeof env?.PORTALESS_IP_HMAC_SECRET === "string" ? env.PORTALESS_IP_HMAC_SECRET.trim() : "";
  const ipHmacSecretConfigured = rawSecret.length >= 16;
  const enforceReady =
    mode !== "invalid" &&
    trustedProxy !== "invalid" &&
    (mode !== "enforce" || ipHmacSecretConfigured);

  return json({
    ok: true,
    trustLayerEnabled: env.ENABLE_TRUST_LAYER === "true",
    mode,
    trustedProxy,
    ipHmacSecretConfigured,
    enforceReady,
    governedPathsCount: countGovernedPaths(env),
    egressBudgets: resolveEgressBudgetLimits(env),
    configError: modeError || proxyError || (mode === "enforce" && !ipHmacSecretConfigured ? "missing_ip_hmac_secret" : null),
  });
}
