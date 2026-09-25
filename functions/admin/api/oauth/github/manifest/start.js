// v0.0.9.27 -- Inicia el registro de la GitHub App de esta instancia via manifiesto.
import { createDeploymentOAuthStore } from "../../../../../../packages/deploy-engine/src/oauth-store";
import { createProviderConfigStore, GITHUB_APP_PROVIDER_ID } from "../../../../../../packages/deploy-engine/src/providers-config-store";
import { beginGitHubManifest } from "../../../../../../packages/deploy-engine/src/github-manifest";

function requireAdmin(context) {
  const user = context.data?.user;
  if (!user) return { error: json({ error: "No autenticado" }, 401) };
  if (user.role !== "admin") return { error: json({ error: "Solo un admin puede registrar la GitHub App" }, 403) };
  return { user };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  if (!context.env?.PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY) {
    return json({ error: "Falta PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: sin ella no se pueden guardar los secretos de la App" }, 501);
  }
  const providerStore = await createProviderConfigStore(context.env);
  if (await providerStore.get(GITHUB_APP_PROVIDER_ID)) {
    return json({ error: "Ya hay una GitHub App registrada en esta instancia" }, 409);
  }
  const html = await beginGitHubManifest(
    await createDeploymentOAuthStore(context.env),
    String(g.user.id ?? g.user.email),
    new URL(context.request.url).origin
  );
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
