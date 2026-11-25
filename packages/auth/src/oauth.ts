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
//   PORTALESS_OAUTH_<PROVIDER>_SCOPE          (opcional; default "openid email profile")
//
// <PROVIDER> en mayusculas, ej. GOOGLE, GITHUB. Ver
// docs/architecture/authentication.md, seccion OAuth/SSO, para el mapeo
// exacto de estas variables y ejemplos reales para Google/GitHub.

import { createHash, randomBytes } from "node:crypto";
import type { OAuthProfile } from "./types";

export const DEFAULT_OAUTH_SCOPE = "openid email profile";
export const OAUTH_PROVIDER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface OAuthProviderConfig {
  provider: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  redirectUri: string;
  scope: string;
}

export interface OAuthEnv {
  [key: string]: string | undefined;
}

/**
 * Valida y normaliza el identificador de proveedor OAuth antes de construir
 * nombres de cookie, paths o claves de entorno (M-07).
 */
export function normalizeOAuthProvider(provider: unknown): string | null {
  if (typeof provider !== "string") return null;
  const normalized = provider.trim().toLowerCase();
  if (!OAUTH_PROVIDER_NAME_RE.test(normalized)) return null;
  return normalized;
}

/** Nombre de cookie ligado al proveedor: `portaless_oauth_state_<provider>`. */
export function oauthStateCookieName(provider: string): string {
  const normalized = normalizeOAuthProvider(provider);
  if (!normalized) {
    throw new Error(`Invalid OAuth provider identifier: "${String(provider)}"`);
  }
  return `portaless_oauth_state_${normalized}`;
}

/** Codifica el valor de la cookie ligando proveedor + state + PKCE verifier. */
export function encodeOAuthStateCookieValue(
  provider: string,
  state: string,
  pkceVerifier: string
): string {
  const normalized = normalizeOAuthProvider(provider);
  if (!normalized) {
    throw new Error(`Invalid OAuth provider identifier: "${String(provider)}"`);
  }
  return `${normalized}:${state}:${pkceVerifier}`;
}

export function decodeOAuthStateCookieValue(
  raw: string
): { provider: string; state: string; pkceVerifier: string } | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  if (parts.length !== 3) return null;
  const [rawProvider, state, pkceVerifier] = parts;
  const provider = normalizeOAuthProvider(rawProvider);
  if (!provider || !state || !pkceVerifier) return null;
  return { provider, state, pkceVerifier };
}

export function loadOAuthProviderConfig(
  provider: string,
  env: OAuthEnv,
  redirectUri: string
): OAuthProviderConfig | null {
  const normalized = normalizeOAuthProvider(provider);
  if (!normalized) return null;

  const prefix = `PORTALESS_OAUTH_${normalized.toUpperCase()}_`;
  const clientId = env[`${prefix}CLIENT_ID`];
  const clientSecret = env[`${prefix}CLIENT_SECRET`];
  const authUrl = env[`${prefix}AUTH_URL`];
  const tokenUrl = env[`${prefix}TOKEN_URL`];
  const userinfoUrl = env[`${prefix}USERINFO_URL`];
  const scope = env[`${prefix}SCOPE`]?.trim() || DEFAULT_OAUTH_SCOPE;

  if (!clientId || !clientSecret || !authUrl || !tokenUrl || !userinfoUrl) {
    return null; // Proveedor no configurado -- el caller debe tratarlo como "no disponible", nunca asumir defaults.
  }

  return {
    provider: normalized,
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
    userinfoUrl,
    redirectUri,
    scope,
  };
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
    scope: config.scope?.trim() || DEFAULT_OAUTH_SCOPE,
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

  const profile = (await userRes.json()) as {
    sub?: string;
    id?: string | number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  const subject = profile.sub ?? (profile.id !== undefined ? String(profile.id) : undefined);
  if (!subject) {
    throw new Error(`OAuth userinfo (${config.provider}) no devolvio un identificador estable (sub/id).`);
  }

  return {
    provider: config.provider,
    subject,
    email: profile.email,
    displayName: profile.name,
    // Solo el booleano explicito cuenta. Un proveedor que omite el claim no
    // autoriza vinculacion automatica por email.
    emailVerified: profile.email_verified === true,
  };
}
