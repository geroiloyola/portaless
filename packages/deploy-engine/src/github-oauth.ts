// Flujo OAuth web de GitHub App (user access token) con state + PKCE (S256).
// Docs: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
import { encryptToken, decryptToken, randomUrlSafe, pkceChallenge } from "./token-crypto";
import type { DeploymentOAuthStore } from "./oauth-store";

export const GITHUB_PROVIDER = "github";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
}

export function readGitHubOAuthConfig(env: any, origin: string): GitHubOAuthConfig | null {
  const clientId = env?.PORTALESS_GITHUB_APP_CLIENT_ID;
  const clientSecret = env?.PORTALESS_GITHUB_APP_CLIENT_SECRET;
  const encryptionKey = env?.PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) return null;
  return { clientId, clientSecret, encryptionKey,
    redirectUri: env?.PORTALESS_GITHUB_OAUTH_REDIRECT_URI || `${origin}/admin/api/oauth/github/callback` };
}

export async function beginGitHubOAuth(cfg: GitHubOAuthConfig, store: DeploymentOAuthStore, userId: string): Promise<string> {
  const state = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(48);
  await store.saveState({ state, provider: GITHUB_PROVIDER, codeVerifier, userId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString() });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type CallbackResult =
  | { ok: true; accountLogin: string }
  | { ok: false; status: number; error: string };

export async function completeGitHubOAuth(
  cfg: GitHubOAuthConfig, store: DeploymentOAuthStore, params: { code: string | null; state: string | null }, userId: string
): Promise<CallbackResult> {
  if (!params.code || !params.state) return { ok: false, status: 400, error: "Faltan code o state" };
  const rec = await store.consumeState(params.state);
  if (!rec || rec.provider !== GITHUB_PROVIDER) return { ok: false, status: 400, error: "state invalido, vencido o ya usado" };
  if (rec.userId !== userId) return { ok: false, status: 403, error: "El state pertenece a otra sesion" };

  const f = cfg.fetchImpl ?? fetch;
  let tok: any;
  try {
    const res = await f("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret,
        code: params.code, redirect_uri: cfg.redirectUri, code_verifier: rec.codeVerifier }),
    });
    tok = await res.json();
    if (!res.ok || tok.error || !tok.access_token) {
      return { ok: false, status: 502, error: `GitHub rechazo el intercambio: ${tok.error_description || tok.error || res.status}` };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `Error de red contra GitHub: ${(e as Error).message}` };
  }

  let login = "";
  try {
    const u = await f("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "portaless" },
    });
    if (u.ok) login = (await u.json()).login ?? "";
  } catch { /* login es informativo, no bloquea */ }

  const t = Date.now();
  await store.saveCredential({
    provider: GITHUB_PROVIDER,
    accountLogin: login,
    accessTokenEnc: await encryptToken(tok.access_token, cfg.encryptionKey),
    refreshTokenEnc: tok.refresh_token ? await encryptToken(tok.refresh_token, cfg.encryptionKey) : null,
    accessExpiresAt: tok.expires_in ? new Date(t + tok.expires_in * 1000).toISOString() : null,
    refreshExpiresAt: tok.refresh_token_expires_in ? new Date(t + tok.refresh_token_expires_in * 1000).toISOString() : null,
    connectedBy: userId,
    updatedAt: new Date(t).toISOString(),
  });
  return { ok: true, accountLogin: login };
}

/** Uso server-side exclusivo (Tarea 2). Nunca exponer por HTTP. */
export async function getGitHubAccessToken(cfg: GitHubOAuthConfig, store: DeploymentOAuthStore): Promise<string | null> {
  const c = await store.getCredential(GITHUB_PROVIDER);
  if (!c) return null;
  if (c.accessExpiresAt && Date.parse(c.accessExpiresAt) - Date.now() < 60_000) {
    return null; // TODO siguiente commit: refresh con refresh_token (ghr_), rota ambos tokens.
  }
  return decryptToken(c.accessTokenEnc, cfg.encryptionKey);
}
