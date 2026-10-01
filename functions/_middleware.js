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
// PR C: politica "charge". Hasta que haya settlement real, "charge" responde
// siempre 402 y nunca registra cobro.
//
// PR C: la politica sale del manifiesto publicado (env.ASSETS), no de
// defaultContentPolicy(). Ver load-policy.ts.

import {
  verifyWebBotAuthRequest,
  recordAgentAccess,
} from "../packages/trust-layer/src/index.ts";
import { createUsageLedgerStore } from "../packages/trust-layer/src/ledger/store-factory.ts";
import { isPublicBotRoute } from "../packages/trust-layer/src/policy/public-bot-routes.ts";
import { loadContentPolicy } from "../packages/trust-layer/src/policy/load-policy.ts";

function looksLikeAutomatedAgent(request) {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|gpt|claude|scrapy|python-requests/i.test(ua);
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (env.ENABLE_TRUST_LAYER !== "true") return next();
  if (isPublicBotRoute(new URL(request.url).pathname)) return next();

  const ledgerStore = await createUsageLedgerStore(env);
  const hasSignature = request.headers.get("Signature-Agent") !== null;
  const automatedLooking = looksLikeAutomatedAgent(request);

  if (!hasSignature && !automatedLooking) return next();

  if (!hasSignature && automatedLooking) {
    return new Response(JSON.stringify({
      error: "unsigned_automated_request",
      message: "Este sitio usa Portaless Trust Layer. Firma tus peticiones segun Web Bot Auth o respeta las politicas en /.well-known/portaless-content-policy.json",
      policy_url: `${new URL(request.url).origin}/.well-known/portaless-content-policy.json`,
    }), { status: 403, headers: { "content-type": "application/json" } });
  }

  const result = await verifyWebBotAuthRequest(request);
  const origin = new URL(request.url).origin;
  const policy = await loadContentPolicy(origin, env.ASSETS);
  const rule = policy.policies.ai_input;

  if (!result.verified) {
    await recordAgentAccess(ledgerStore, { operatorKeyId: "unverified", charged: false, amountUsd: 0, policyViolation: true });
    return new Response(JSON.stringify({ error: "verification_failed", reason: result.reason }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const operatorKeyId = result.agentKeyId ?? result.keyRecord?.keyId ?? "unknown";

  if (rule.access === "block") {
    await recordAgentAccess(ledgerStore, { operatorKeyId, charged: false, amountUsd: 0 });
    return new Response(JSON.stringify({ error: "ai_input_blocked_by_policy" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  if (rule.access === "charge") {
    await recordAgentAccess(ledgerStore, { operatorKeyId, charged: false, amountUsd: 0 });
    return new Response(JSON.stringify({
      error: "payment_required",
      price_usd: rule.price_usd,
      unit: rule.unit,
      settlement: "not_available",
      message: "Este sitio cobra el acceso de agentes pero todavia no tiene un medio de pago verificable. No reintentes con un comprobante: no se acepta ninguno.",
      policy_url: `${origin}/.well-known/portaless-content-policy.json`,
    }), { status: 402, headers: { "content-type": "application/json" } });
  }

  return next();
}
