// Cloudflare Pages Function -- segundo paso de login cuando el usuario
// tiene 2FA activo. POST /admin/login-mfa recibe { challengeToken, code }
// (challengeToken viene del mfaChallengeToken devuelto por /admin/login
// cuando AuthService.login() responde mfaRequired:true; login.js redirige a
// /admin/login-mfa?challenge=<token>).
//
// Solo exporta POST: GET /admin/login-mfa cae a la pagina estatica
// (src/pages/admin/login-mfa.astro), igual en Cloudflare Pages y en el runtime Node.
//
// La cookie lleva Secure solo en HTTPS, igual que login.js: en self-hosted por
// HTTP en una IP de red local el navegador descartaria una cookie Secure.
//
// El challenge se lee de createMfaChallengeStore(env), el mismo store donde
// login.js lo guardo. Los fallos se cuentan ahi (maximo MFA_MAX_ATTEMPTS),
// asi que repartir intentos entre isolates no saltea el limite.

import { AuthService } from "../../packages/auth/src/auth-service.ts";
import {
  createUsersStore,
  createSessionStore,
  createMfaChallengeStore,
} from "../../packages/auth/src/store-factory.ts";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Cuerpo de la solicitud inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { challengeToken, code } = body || {};
  if (typeof challengeToken !== "string" || !challengeToken || typeof code !== "string" || !code) {
    return new Response(JSON.stringify({ success: false, error: "Faltan challengeToken o code." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const mfaChallengeStore = await createMfaChallengeStore(env);
  const authService = new AuthService(usersStore, sessionStore, undefined, undefined, mfaChallengeStore);

  const result = await authService.completeMfaLogin(challengeToken, code);

  if (!result.success || !result.session) {
    return new Response(JSON.stringify({ success: false, error: result.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cookieFlags = [
    `portaless_session=${result.session.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (new URL(request.url).protocol === "https:") cookieFlags.push("Secure");

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookieFlags.join("; "));

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
