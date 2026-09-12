// Cloudflare Pages Function - middleware global del Trust Layer.
// ACTUALIZADO v0.0.6: ledger via store-factory.ts (D1/SQLite), no memoria.

import {
  verifyWebBotAuthRequest,
  recordAgentAccess,
  defaultContentPolicy,
} from "../packages/trust-layer/src/index.ts";
import { createUsageLedgerStore } from "../packages/trust-layer/src/ledger/store-factory.ts";

function looksLikeAutomatedAgent(request) {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|gpt|claude|scrapy|python-requests/i.test(ua);
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (env.ENABLE_TRUST_LAYER !== "true") return next();

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
  const policy = defaultContentPolicy(new URL(request.url).origin);
  const rule = policy.policies.ai_input;

  if (!result.verified) {
    await recordAgentAccess(ledgerStore, { operatorKeyId: "unverified", charged: false, amountUsd: 0, policyViolation: true });
    return new Response(JSON.stringify({ error: "verification_failed", reason: result.reason }), { status: 401, headers: { "content-type": "application/json" } });
  }

  if (rule.access === "block") {
    await recordAgentAccess(ledgerStore, { operatorKeyId: result.keyRecord.keyId, charged: false, amountUsd: 0 });
    return new Response(JSON.stringify({ error: "ai_input_blocked_by_policy" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  if (rule.access === "charge") {
    const paymentHeader = request.headers.get("X-Payment-Proof");
    if (!paymentHeader) {
      await recordAgentAccess(ledgerStore, { operatorKeyId: result.keyRecord.keyId, charged: false, amountUsd: 0 });
      return new Response(JSON.stringify({ error: "payment_required", price_usd: rule.price_usd, unit: rule.unit }), { status: 402, headers: { "content-type": "application/json" } });
    }
    await recordAgentAccess(ledgerStore, { operatorKeyId: result.keyRecord.keyId, charged: true, amountUsd: rule.price_usd ?? 0 });
  }

  return next();
}
