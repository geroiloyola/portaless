// v0.0.9.27 -- GitHub redirige aca con ?code&state tras crear la App.
import { createDeploymentOAuthStore } from "../../../../../../packages/deploy-engine/src/oauth-store";
import { createProviderConfigStore } from "../../../../../../packages/deploy-engine/src/providers-config-store";
import { completeGitHubManifest, escapeHtml } from "../../../../../../packages/deploy-engine/src/github-manifest";

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
  const encryptionKey = context.env?.PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return json({ error: "Falta PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY" }, 501);

  const reqUrl = new URL(context.request.url);
  const r = await completeGitHubManifest(
    {
      oauthStore: await createDeploymentOAuthStore(context.env),
      providerStore: await createProviderConfigStore(context.env),
      encryptionKey,
    },
    { code: reqUrl.searchParams.get("code"), state: reqUrl.searchParams.get("state") },
    String(g.user.id ?? g.user.email)
  );

  if (r.ok) return Response.redirect(r.installUrl, 302);

  if (r.orphanHtmlUrl) {
    const url = escapeHtml(`${r.orphanHtmlUrl}`);
    const settings = escapeHtml(`https://github.com/settings/apps`);
    return new Response(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>App creada pero no guardada</title></head><body>
<h1>La GitHub App se creo, pero Portaless no pudo guardarla</h1>
<p>${escapeHtml(r.error)}</p>
<p>1. Abri la App: <a href="${url}">${url}</a> y eliminala desde <a href="${settings}">GitHub &rarr; Settings &rarr; Developer settings &rarr; GitHub Apps</a>.</p>
<p>2. Volve a <a href="/admin/wizard/step-2-infrastructure">Paso 2 del Wizard</a> e intenta de nuevo.</p>
</body></html>`,
      { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  return json({ error: r.error }, r.status);
}
