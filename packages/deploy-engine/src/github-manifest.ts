// v0.0.9.27 -- Registro de la GitHub App via manifiesto (1 clic, sin .env).
// Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
//
// 1. begin: guarda un state (provider='github_manifest', un solo uso, atado al
//    admin) y devuelve una pagina que hace POST del manifiesto a GitHub.
// 2. complete: valida state, canjea el code (UN SOLO USO, expira en 1h) en
//    POST /app-manifests/{code}/conversions y persiste los secretos cifrados.
//    Si la persistencia falla DESPUES del canje, la App ya existe en GitHub:
//    se devuelve orphanHtmlUrl para que el usuario la borre y reintente.
import { randomUrlSafe } from "./token-crypto";
import type { DeploymentOAuthStore } from "./oauth-store";
import { type ProviderConfigStore, GITHUB_APP_PROVIDER_ID, saveProviderConfig } from "./providers-config-store";

export const MANIFEST_STATE_PROVIDER = "github_manifest";
const STATE_TTL_MS = 10 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function buildGitHubAppManifest(origin: string) {
  const host = new URL(origin).host;
  const suffix = randomUrlSafe(3).replace(/[^A-Za-z0-9]/g, "x").slice(0, 4);
  return {
    name: `${`Portaless ${host}`.slice(0, 29)} ${suffix}`,
    url: origin,
    redirect_url: `${origin}/admin/api/oauth/github/manifest/callback`,
    callback_urls: [`${origin}/admin/api/oauth/github/callback`],
    hook_attributes: { url: `${origin}/admin/api/oauth/github/webhook`, active: false },
    public: false,
    default_permissions: { contents: "write", pages: "write", administration: "write", metadata: "read" },
    default_events: [],
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function beginGitHubManifest(oauthStore: DeploymentOAuthStore, userId: string, origin: string): Promise<string> {
  const state = randomUrlSafe(32);
  await oauthStore.saveState({
    state,
    provider: MANIFEST_STATE_PROVIDER,
    codeVerifier: "",
    userId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  const manifest = escapeHtml(JSON.stringify(buildGitHubAppManifest(origin)));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Conectando con GitHub</title></head><body>
<p>Redirigiendo a GitHub para crear la App de Portaless...</p>
<form id="portaless-manifest" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${manifest}">
<button type="submit">Crear la GitHub App de Portaless</button>
</form>
<script>document.getElementById("portaless-manifest").submit();</script>
</body></html>`;
}

export type ManifestResult =
  | { ok: true; appSlug: string; installUrl: string }
  | { ok: false; status: number; error: string; orphanHtmlUrl?: string };

export async function completeGitHubManifest(
  deps: { oauthStore: DeploymentOAuthStore; providerStore: ProviderConfigStore; encryptionKey: string; fetchImpl?: typeof fetch },
  params: { code: string | null; state: string | null },
  userId: string
): Promise<ManifestResult> {
  if (!params.code || !params.state) return { ok: false, status: 400, error: "Faltan code o state" };
  if (!CODE_RE.test(params.code)) return { ok: false, status: 400, error: "code con formato invalido" };
  const rec = await deps.oauthStore.consumeState(params.state);
  if (!rec || rec.provider !== MANIFEST_STATE_PROVIDER) return { ok: false, status: 400, error: "state invalido, vencido o ya usado" };
  if (rec.userId !== userId) return { ok: false, status: 403, error: "El state pertenece a otra sesion" };

  // Chequeo ANTES del canje: canjear y despues descubrir el conflicto dejaria una App huerfana.
  if (await deps.providerStore.get(GITHUB_APP_PROVIDER_ID)) {
    return { ok: false, status: 409, error: "Ya hay una GitHub App registrada en esta instancia (rotacion no soportada todavia)" };
  }

  const f = deps.fetchImpl ?? fetch;
  let app: any;
  try {
    const res = await f(`https://api.github.com/app-manifests/${params.code}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": "portaless" },
    });
    app = await res.json().catch(() => ({}));
    if (!res.ok || !app.id || !app.client_id || !app.client_secret || !app.pem) {
      return { ok: false, status: 502, error: `GitHub rechazo la conversion del manifiesto (${res.status}): ${app.message ?? "sin detalle"}` };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `Error de red contra GitHub: ${(e as Error).message}` };
  }

  try {
    await saveProviderConfig(
      deps.providerStore,
      {
        providerId: GITHUB_APP_PROVIDER_ID,
        appId: String(app.id),
        appSlug: String(app.slug ?? ""),
        clientId: app.client_id,
        clientSecret: app.client_secret,
        privateKey: app.pem,
        webhookSecret: app.webhook_secret ?? null,
        htmlUrl: app.html_url ?? null,
        createdBy: userId,
      },
      deps.encryptionKey
    );
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: `La GitHub App se creo en GitHub pero no se pudo guardar en Portaless (${(e as Error).message}). Eliminala en GitHub y volve a intentarlo.`,
      orphanHtmlUrl: app.html_url,
    };
  }

  return { ok: true, appSlug: String(app.slug ?? ""), installUrl: `${app.html_url}/installations/new` };
}
