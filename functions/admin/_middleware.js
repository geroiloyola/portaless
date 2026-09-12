// Cloudflare Pages Function -- middleware exclusivo de las rutas
// /admin/*. Protege el dashboard verificando la cookie de sesion antes de
// servir cualquier ruta bajo este prefijo. La ruta /admin/login queda
// explicitamente excluida (si no, nadie podria loguearse nunca).
//
// IMPORTANTE: este middleware es independiente del de la raiz
// (functions/_middleware.js, del Trust Layer) -- Cloudflare Pages aplica
// el _middleware.js mas especifico a la ruta que coincide, en cascada
// desde la raiz hacia la carpeta actual. No se duplica logica del Trust
// Layer aqui.

import { AuthService, InMemoryUsersStore, InMemorySessionStore } from "../../packages/auth/src/index.ts";

// NOTA DE ESTADO: estos stores en memoria se reinician con cada
// despliegue/reinicio del proceso -- ver docs/architecture/authentication.md
// para el plan de migracion a persistencia real (SQLite). Mientras tanto,
// cualquier usuario creado debe re-crearse tras cada reinicio, o mejor:
// ejecutar la creacion del admin inicial en un paso de build/deploy, no
// en tiempo de request.
const usersStore = new InMemoryUsersStore();
const sessionStore = new InMemorySessionStore();
const authService = new AuthService(usersStore, sessionStore);

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.pathname === "/admin/login") {
    return next();
  }

  const token = getCookie(request, "portaless_session");
  const session = await authService.validateSession(token);

  if (!session) {
    return Response.redirect(new URL("/admin/login?error=1", url.origin), 302);
  }

  // Adjunta la sesion al contexto para que las paginas admin puedan leer
  // el rol del usuario (ej. para ocultar controles de escritura a "viewer").
  context.data = { ...(context.data || {}), session };

  return next();
}
