import { createDeploymentOAuthStore } from "../../../../../packages/deploy-engine/src/oauth-store";
import { readGitHubOAuthConfig, completeGitHubOAuth } from "../../../../../packages/deploy-engine/src/github-oauth";

function requireAdmin(context) {
  // Mismo contrato que el resto de /admin: _middleware.js expone context.data.user.
  const user = context.data?.user;
  if (!user) return { error: json({ error: "No autenticado" }, 401) };
  if (user.role !== "admin") return { error: json({ error: "Solo un admin puede conectar infraestructura" }, 403) };
  return { user };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  const reqUrl = new URL(context.request.url);
  const back = new URL("/admin/wizard/step-2-infrastructure", reqUrl.origin);
  if (reqUrl.searchParams.get("error")) {
    back.searchParams.set("github", "denied");
    return Response.redirect(back.toString(), 302);
  }
  const cfg = await readGitHubOAuthConfig(context.env, reqUrl.origin);
  if (!cfg) return json({ error: "GitHub App no configurada" }, 501);
  const store = await createDeploymentOAuthStore(context.env);
  const r = await completeGitHubOAuth(cfg, store,
    { code: reqUrl.searchParams.get("code"), state: reqUrl.searchParams.get("state") },
    String(g.user.id ?? g.user.email));
  if (!r.ok) return json({ error: r.error }, r.status);
  back.searchParams.set("github", "connected");
  return Response.redirect(back.toString(), 302);
}
