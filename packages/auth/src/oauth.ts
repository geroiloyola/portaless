// OAuth/SSO minimo via Authorization Code + PKCE (RFC 7636), sin libreria
// externa -- usa fetch nativo y node:crypto para PKCE, consistente con la
// filosofia de password.ts/totp.ts de este paquete (menos dependencias =
// despliegues self-hosted mas simples).
//
// Configuracion via variables de entorno, NO hardcodeada, para no atar
// Portaless a un proveedor especifico:
//   PORTALESS_OAUTH_<PROVIDER>_CLIENT_ID
//   PORTALESS_OAUTH_<PROVIDER>_CLIENT_SECRET
//   PORTALESS_OAUTH_<PROVIDER>_AUTH_URL
//   PORTALESS_OAUTH_<PROVIDER>_TOKEN_URL
//   PORTALESS_OAUTH_<PROVIDER>_USERINFO_URL
//
// <PROVIDER> en mayusculas, ej. GOOGLE, GITHUB. Ver
// docs/architecture/authentication.md, seccion OAuth/SSO, para el mapeo
// exacto de estas variables y ejemplos reales para Google/GitHub.

import { createHash, randomBytes } from "node:crypto";
import type { OAuthProfile } from "./types";

export interface OAuthProviderConfig {
  provider: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  redirectUri: string;
}

export interface OAuthEnv {
  [key: string]: string | undefined;
}

export function loadOAuthProviderConfig(
  provider: string,
  env: OAuthEnv,
  redirectUri: string
): OAuthProviderConfig | null {
  const prefix = `PORTALESS_OAUTH_${provider.toUpperCase()}_`;
  const clientId = env[`${prefix}CLIENT_ID`];
  const clientSecret = env[`${prefix}CLIENT_SECRET`];
  const authUrl = env[`${prefix}AUTH_URL`];
  const tokenUrl = env[`${prefix}TOKEN_URL`];
  const userinfoUrl = env[`${prefix}USERINFO_URL`];

  if (!clientId || !clientSecret || !authUrl || !tokenUrl || !userinfoUrl) {
    return null; // Proveedor no configurado -- el caller debe tratarlo como "no disponible", nunca asumir defaults.
  }

  return { provider, clientId, clientSecret, authUrl, tokenUrl, userinfoUrl, redirectUri };
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  pkceChallenge: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: pkceChallenge,
    code_challenge_method: "S256",
  });
  return `${config.authUrl}?${params.toString()}`;
}

/**
 * Intercambia el codigo de autorizacion por un token y obtiene el perfil
 * del usuario. Unico punto del modulo que hace fetch real -- separado para
 * poder mockearlo en tests (mismo patron que los adaptadores edge de
 * plugin-sandbox, ver tests/e2e/sandbox-deno-deploy-adapter.test.ts).
 */
export async function exchangeCodeForProfile(
  config: OAuthProviderConfig,
  code: string,
  pkceVerifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthProfile> {
  const tokenRes = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: pkceVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`OAuth token exchange fallo (${config.provider}): HTTP ${tokenRes.status}`);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new Error(`OAuth token exchange (${config.provider}) no devolvio access_token.`);
  }

  const userRes = await fetchImpl(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`OAuth userinfo fallo (${config.provider}): HTTP ${userRes.status}`);
  }

  const profile = (await userRes.json()) as { sub?: string; id?: string | number; email?: string; name?: string };
  const subject = profile.sub ?? (profile.id !== undefined ? String(profile.id) : undefined);
  if (!subject) {
    throw new Error(`OAuth userinfo (${config.provider}) no devolvio un identificador estable (sub/id).`);
  }

  return {
    provider: config.provider,
    subject,
    email: profile.email,
    displayName: profile.name,
  };
}
