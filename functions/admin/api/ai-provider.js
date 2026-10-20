// Admin-only status for the explicit OpenAI-compatible provider profile.
// GET /admin/api/ai-provider
//
// The API key is read from the server environment and is never returned.
// This endpoint exists so an operator can verify which endpoint/model and
// capabilities are active before an acceptance run.

import { loadOpenAICompatibleConfig } from "../../../packages/ai-provider/src/index.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ data, env }) {
  if (!data?.user) return json({ error: "unauthenticated" }, 401);
  if (data.user.role !== "admin") return json({ error: "forbidden" }, 403);
  const result = loadOpenAICompatibleConfig(env ?? {});
  return json({
    enabled: result.enabled,
    profile: result.profile,
    errors: result.errors,
    note: "The API key is read server-side from PORTALESS_OPENAI_API_KEY and is never returned.",
  });
}
