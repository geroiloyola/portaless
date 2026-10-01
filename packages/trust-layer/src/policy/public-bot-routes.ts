// Rutas que cualquier agente tiene que poder leer SIN firma Web Bot Auth.
// Son la fase de descubrimiento: sin ellas un bot legitimo no puede saber
// como firmar, que permite la politica ni que contenido hay. Bloquearlas con
// el 403 del middleware deja al bot sin forma de cumplir las reglas.
//
// Es politica de seguridad: cualquier cambio en esta lista tiene que pasar
// por tests/unit/public-bot-routes.test.ts.
//
// Recibe url.pathname, que el parser de URL ya normaliza (resuelve ".." y
// "."), asi que "/.well-known/../admin" llega como "/admin".

const EXACT_PUBLIC_PATHS = new Set(["/robots.txt", "/llms.txt", "/sitemap.xml"]);

export function isPublicBotRoute(pathname: string): boolean {
  if (EXACT_PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/.well-known/")) return true;
  if (pathname.startsWith("/blog/") && pathname.endsWith(".md")) return true;
  return false;
}
