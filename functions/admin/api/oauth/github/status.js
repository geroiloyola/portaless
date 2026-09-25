import { createDeploymentOAuthStore } from "../../../../../packages/deploy-engine/src/oauth-store";
import { GITHUB_PROVIDER } from "../../../../../packages/deploy-engine/src/github-oauth";
import { createProviderConfigStore, GITHUB_APP_PROVIDER_ID } from "../../../../../packages/deploy-engine/src/providers-config-store";

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

// GET: estado de conexion SIN exponer nunca tokens ni secretos. DELETE: desconectar.
// v0.0.9.27: agrega appRegistered/appSlug (App via manifiesto) y envConfigured
// (App via env vars) para que el Wizard sepa que paso mostrar.
export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  const env = context.env;
  const c = await (await createDeploymentOAuthStore(env)).getCredential(GITHUB_PROVIDER);
  const app = await (await createProviderConfigStore(env)).get(GITHUB_APP_PROVIDER_ID);
  const base = {
    appRegistered: Boolean(app),
    appSlug: app?.app_slug ?? null,
    envConfigured: Boolean(env?.PORTALESS_GITHUB_APP_CLIENT_ID && env?.PORTALESS_GITHUB_APP_CLIENT_SECRET),
  };
  return json(c ? { ...base, connected: true, accountLogin: c.accountLogin, accessExpiresAt: c.accessExpiresAt,
    refreshExpiresAt: c.refreshExpiresAt, updatedAt: c.updatedAt } : { ...base, connected: false });
}
export async function onRequestDelete(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  await (await createDeploymentOAuthStore(context.env)).deleteCredential(GITHUB_PROVIDER);
  return json({ connected: false });
}
