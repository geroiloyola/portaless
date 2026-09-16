// Cloudflare Pages Function que maneja el endpoint real de login.
// GET /admin/login -> deja pasar a la pagina estatica (login.astro).
// POST /admin/login -> valida credenciales y setea la cookie de sesion.
//
// v0.0.9.5: si AuthService.login() devuelve mfaRequired:true (usuario con
// 2FA activo), este endpoint ya NO lo trata como error generico -- redirige
// a /admin/login-mfa?challenge=<mfaChallengeToken> para que el usuario
// complete el segundo paso. Ver docs/architecture/authentication.md,
// seccion 2FA, y functions/admin/login-mfa.js (segundo paso).

import { AuthService } from "../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../packages/auth/src/store-factory.ts";

export async function onRequestGet(context) {
  return context.next();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const authService = new AuthService(usersStore, sessionStore);

  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  const result = await authService.login(username, password);

  if (result.mfaRequired && result.mfaChallengeToken) {
    const redirectUrl = new URL("/admin/login-mfa", request.url);
    redirectUrl.searchParams.set("challenge", result.mfaChallengeToken);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (!result.success || !result.session) {
    return Response.redirect(new URL("/admin/login?error=1", request.url).toString(), 302);
  }

  const isSecureContext = new URL(request.url).protocol === "https:";
  const cookieFlags = [
    `portaless_session=${result.session.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${24 * 60 * 60}`,
  ];
  if (isSecureContext) cookieFlags.push("Secure");

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookieFlags.join("; "),
      Location: new URL("/admin/", request.url).toString(),
    },
  });
}
