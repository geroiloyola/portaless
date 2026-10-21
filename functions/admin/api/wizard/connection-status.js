// Admin-only connection status for C35. Tokens are read server-side and never
// returned; each provider is validated with a real read-only call.

import { checkPrivateNode, checkGitHubConnection, checkCloudflareConnection } from "../../../../packages/deploy-engine/src/connection-validator.ts";
import { createDeploymentOAuthStore } from "../../../../packages/deploy-engine/src/oauth-store.ts";
import { readGitHubOAuthConfig, getGitHubAccessToken } from "../../../../packages/deploy-engine/src/github-oauth.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function onRequestGet({ data, env }) {
  if (!data?.user) return json({ error: "unauthenticated" }, 401);
  if (data.user.role !== "admin") return json({ error: "forbidden" }, 403);
  const fetchImpl = typeof env?.__PORTALESS_FETCH === "function" ? env.__PORTALESS_FETCH : fetch;
  const backend = env?.DB ? "d1" : env?.PORTALESS_SQLITE_PATH ? "sqlite" : "memory";
  const privateNode = checkPrivateNode({
    backend,
    sqlitePath: env?.PORTALESS_SQLITE_PATH ?? null,
    writable: true,
  });

  let githubToken = null;
  try {
    const oauthEnv = { ...(env ?? {}), __PORTALESS_FETCH: fetchImpl };
    const cfg = await readGitHubOAuthConfig(oauthEnv, "http://localhost");
    if (cfg) githubToken = await getGitHubAccessToken(cfg, await createDeploymentOAuthStore(oauthEnv));
  } catch {
    githubToken = null;
  }
  const github = await checkGitHubConnection(fetchImpl, githubToken);
  const cloudflare = await checkCloudflareConnection(fetchImpl, {
    token: env?.PORTALESS_CLOUDFLARE_API_TOKEN,
    accountId: env?.PORTALESS_CLOUDFLARE_ACCOUNT_ID,
    project: env?.PORTALESS_CLOUDFLARE_PAGES_PROJECT,
  });
  return json({
    privateNode,
    github,
    cloudflare,
    note: "Solo se devuelven estados y cuentas públicas; ningún token ni secreto se incluye en la respuesta.",
  });
}
