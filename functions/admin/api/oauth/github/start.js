import { createDeploymentOAuthStore } from "../../../../../packages/deploy-engine/src/oauth-store";
import { readGitHubOAuthConfig, beginGitHubOAuth } from "../../../../../packages/deploy-engine/src/github-oauth";
import { publicOriginFromEnv } from "../../../../_shared/public-origin.js";

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
  if (typeof g.user.username !== "string" || !g.user.username) return json({ error: "Sesion sin usuario" }, 401);
  const origin = publicOriginFromEnv(context.env);
  if (!origin) return json({ error: "public_origin_not_configured" }, 503);
  const cfg = await readGitHubOAuthConfig(context.env, origin);
  if (!cfg) {
    return json({
      error: "GitHub App no configurada. Registrala en 1 clic via /admin/api/oauth/github/manifest/start, " +
        "o carga PORTALESS_GITHUB_APP_CLIENT_ID/SECRET. PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY es obligatoria.",
    }, 501);
  }
  const store = await createDeploymentOAuthStore(context.env);
  const url = await beginGitHubOAuth(cfg, store, g.user.username);
  return Response.redirect(url, 302);
}
