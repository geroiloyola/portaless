// Cloudflare Pages Function - middleware global.
// Se ejecuta en cada request antes de servir el sitio estatico.
// Activa el Trust Layer solo si ENABLE_TRUST_LAYER=true (variable de entorno
// del proyecto de Pages). Si esta desactivado, no agrega ninguna latencia
// ni logica extra -- mismo principio de "opcional, no obligatorio" aplicado
// al modulo de comercio.

import {
  verifyWebBotAuthRequest,
  recordAgentAccess,
  InMemoryUsageLedgerStore,
  defaultContentPolicy,
} from "../packages/trust-layer/src/index.ts";

const ledgerStore = new InMemoryUsageLedgerStore();

function looksLikeAutomatedAgent(request) {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|gpt|claude|scrapy|python-requests/i.test(ua);
}

export async function onRequest(context) {
  const { request, env, next } = context;

  if (env.ENABLE_TRUST_LAYER !== "true") {
    return next();
  }

  const hasSignature = request.headers.get("Signature-Agent") !== null;
  const automatedLooking = looksLikeAutomatedAgent(request);

  if (!hasSignature && !automatedLooking) {
    // Trafico humano normal: no se toca.
    return next();
  }

  if (!hasSignature && automatedLooking) {
    // Agente automatizado sin firma Web Bot Auth: se le informa la politica
    // en vez de bloquearlo silenciosamente, para dar oportunidad de cumplir.
    return new Response(
      JSON.stringify({
        error: "unsigned_automated_request",
        message:
          "Este sitio usa Portaless Trust Layer. Firma tus peticiones segun " +
          "Web Bot Auth (draft-meunier-web-bot-auth-architecture) o respeta " +
          "las politicas en /.well-known/portaless-content-policy.json",
        policy_url: `${new URL(request.url).origin}/.well-known/portaless-content-policy.json`,
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const result = await verifyWebBotAuthRequest(request);
  const policy = defaultContentPolicy(new URL(request.url).origin);
  const rule = policy.policies.ai_input;

  if (!result.verified) {
    await recordAgentAccess(ledgerStore, {
      operatorKeyId: "unverified",
      charged: false,
      amountUsd: 0,
      policyViolation: true,
    });
    return new Response(
      JSON.stringify({ error: "verification_failed", reason: result.reason }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  if (rule.access === "block") {
    await recordAgentAccess(ledgerStore, {
      operatorKeyId: result.keyRecord.keyId,
      charged: false,
      amountUsd: 0,
    });
    return new Response(
      JSON.stringify({ error: "ai_input_blocked_by_policy" }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  if (rule.access === "charge") {
    // TODO: integrar liquidacion real (ver packages/trust-layer/src/billing).
    // Por ahora se responde 402 informativo si no hay evidencia de pago.
    const paymentHeader = request.headers.get("X-Payment-Proof");
    if (!paymentHeader) {
      await recordAgentAccess(ledgerStore, {
        operatorKeyId: result.keyRecord.keyId,
        charged: false,
        amountUsd: 0,
      });
      return new Response(
        JSON.stringify({
          error: "payment_required",
          price_usd: rule.price_usd,
          unit: rule.unit,
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      );
    }

    await recordAgentAccess(ledgerStore, {
      operatorKeyId: result.keyRecord.keyId,
      charged: true,
      amountUsd: rule.price_usd ?? 0,
    });
  }

  return next();
}
