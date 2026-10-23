import {
  createResolutionBudgetConfigStore,
  INVALID_RESOLUTION_BUDGET_CONFIG,
  RESOLUTION_BUDGET_CONFIG_CONFLICT,
} from "../../../packages/trust-layer/src/net/resolution-budget-config.ts";
import { emitActivity } from "../../../packages/dashboard/src/activity/activity-store.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function authenticated(context) {
  return context.data?.user ?? null;
}

export async function onRequestGet(context) {
  const user = authenticated(context);
  if (!user) return json({ error: "unauthenticated" }, 401);
  const store = await createResolutionBudgetConfigStore(context.env ?? {});
  try {
    const saved = await store.read();
    return json({
      config: saved?.config ?? null,
      revision: saved?.revision ?? null,
      updatedAt: saved?.updatedAt ?? null,
      updatedBy: saved?.updatedBy ?? null,
      configured: Boolean(saved),
      effective: false,
      activation: "pending_runtime_integration",
      writable: user.role === "admin",
    });
  } finally { store.close?.(); }
}

export async function onRequestPut(context) {
  const user = authenticated(context);
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: "invalid_resolution_budget_config_body" }, 400); }

  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !["config", "expectedRevision"].includes(key))
    || !("config" in body) || !("expectedRevision" in body)
    || (body.expectedRevision !== null && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1))) {
    return json({ error: INVALID_RESOLUTION_BUDGET_CONFIG }, 400);
  }

  const store = await createResolutionBudgetConfigStore(context.env ?? {});
  let saved;
  try {
    saved = await store.compareAndSet(body.expectedRevision, body.config, user.username);
  } catch (error) {
    store.close?.();
    if (error?.message === INVALID_RESOLUTION_BUDGET_CONFIG) return json({ error: error.message }, 400);
    if (error?.message === RESOLUTION_BUDGET_CONFIG_CONFLICT) return json({ error: error.message }, 409);
    throw error;
  }
  store.close?.();
  await emitActivity(context.env, {
    kind: "resolution_budget.config_changed",
    actor: user.username,
    subject: `revision:${saved.revision}`,
    detail: "configuracion de presupuesto versionada; no efectiva hasta integrar el runtime",
  });
  return json({ ok: true, ...saved, effective: false, activation: "pending_runtime_integration" });
}
