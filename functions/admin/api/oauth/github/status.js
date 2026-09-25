import { createDeploymentOAuthStore } from "../../../../../packages/deploy-engine/src/oauth-store";
import { GITHUB_PROVIDER } from "../../../../../packages/deploy-engine/src/github-oauth";

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

// GET: estado de conexion SIN exponer nunca el token. DELETE: desconectar.
export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  const c = await (await createDeploymentOAuthStore(context.env)).getCredential(GITHUB_PROVIDER);
  return json(c ? { connected: true, accountLogin: c.accountLogin, accessExpiresAt: c.accessExpiresAt,
    refreshExpiresAt: c.refreshExpiresAt, updatedAt: c.updatedAt } : { connected: false });
}
export async function onRequestDelete(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;
  await (await createDeploymentOAuthStore(context.env)).deleteCredential(GITHUB_PROVIDER);
  return json({ connected: false });
}
