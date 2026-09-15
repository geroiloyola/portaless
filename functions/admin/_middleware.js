// Cloudflare Pages Function -- middleware exclusivo de las rutas
// /admin/*. Protege el dashboard verificando la cookie de sesion antes de
// servir cualquier ruta bajo este prefijo. La ruta /admin/login queda
// explicitamente excluida.
//
// ACTUALIZADO: ya no usa stores en memoria hardcodeados. Resuelve el
// backend de persistencia real (D1 en Cloudflare, o SQLite self-hosted)
// via store-factory.ts, coherente con el endpoint de login
// (functions/admin/login.js).

import { AuthService } from "../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../packages/auth/src/store-factory.ts";

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (url.pathname === "/admin/login") {
    return next();
  }

  const usersStore = await createUsersStore(env);
  const sessionStore = await createSessionStore(env);
  const authService = new AuthService(usersStore, sessionStore);

  const token = getCookie(request, "portaless_session");
  const session = await authService.validateSession(token);

  if (!session) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  // Expuesto como `user` (no solo `session`) porque los endpoints de
  // escritura bajo /admin/* (ver functions/admin/pages/[slug].js) leen
  // context.data.user.role para el guard de permisos server-side. Se
  // mantiene tambien `session` como alias por compatibilidad con codigo
  // existente que ya lo consuma.
  context.data = { ...(context.data || {}), user: session, session };

  return next();
}
