// POST /admin/logout
// Destruye la sesion actual en el SessionStore y limpia la cookie
// `portaless_session` con los mismos atributos (HttpOnly, SameSite=Strict,
// Secure en HTTPS, Max-Age=0) y Cache-Control: no-store.

import { AuthService } from "@portaless/auth/service";
import { createUsersStore, createSessionStore } from "@portaless/auth/store-factory";
import { isTrustedRequestOrigin } from "../_shared/request-origin.js";
import { clearSessionCookie, getCookie } from "../_shared/request-security.js";

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isTrustedRequestOrigin(request, env, { requireOrigin: true })) {
    return json({ ok: false, error: "invalid_request_origin" }, 403);
  }

  const token = getCookie(request, "portaless_session");
  if (token) {
    const authService = new AuthService(
      await createUsersStore(env),
      await createSessionStore(env)
    );
    await authService.logout(token);
  }

  return json(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie(request, env) }
  );
}
