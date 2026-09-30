// Rutas bajo /admin/* que deben responder SIN sesion: son las que un usuario
// necesita para obtener una. Usado por functions/admin/_middleware.js.
//
// Coincidencia EXACTA a proposito. Nunca usar startsWith: "/admin/login-x" o
// "/admin/password-reset/../editor" no deben heredar la excepcion.
//
// Deliberadamente protegidas (NO agregar aqui):
//   - /admin/wizard/* y /admin/api/wizard/*: onboarding de un admin ya logueado.
//     Crear el primer admin sin sesion es /setup (fuera de /admin, ADR-002).
//   - /admin/api/oauth/*: credenciales de despliegue (GitHub App).
// Si una ruta nueva debe ser publica, agregarla con su test en
// tests/unit/public-admin-paths.test.ts.

const EXACT_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/admin/login",
  "/admin/login-mfa",
  "/admin/password-reset",
  "/admin/password-reset/request",
  "/admin/password-reset/confirm",
]);

// OAuth de LOGIN (functions/admin/oauth/[provider]/start.js y callback.js).
const OAUTH_LOGIN_PATH = /^\/admin\/oauth\/[a-z0-9-]{1,32}\/(start|callback)$/;

export function isPublicAdminPath(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length === 0 || pathname.length > 256) return false;
  // Ninguna ruta publica legitima lleva escapes, dobles barras ni segmentos punto.
  if (pathname.includes("%") || pathname.includes("\\") || pathname.includes("//")) return false;
  if (/(^|\/)\.{1,2}(\/|$)/.test(pathname)) return false;
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return EXACT_PUBLIC_PATHS.has(normalized) || OAUTH_LOGIN_PATH.test(normalized);
}
