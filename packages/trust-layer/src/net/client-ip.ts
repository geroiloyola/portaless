// IP del cliente para rate limits y hashing, igual en Cloudflare y en el
// runtime Node self-hosted.
//
// - Cloudflare Pages/Workers: CF-Connecting-IP, que pone Cloudflare y el
//   cliente no puede falsificar.
// - Runtime Node (server/node-runtime.mjs): el runtime descarta cualquier
//   header de IP enviado por el cliente (incluido CF-Connecting-IP) y
//   escribe NODE_CLIENT_IP_HEADER con la IP que calcula: X-Forwarded-For
//   solo si la conexion viene de un proxy listado en
//   PORTALESS_TRUSTED_PROXIES, si no la IP del socket. Marca el entorno con
//   env.__PORTALESS_RUNTIME === "node".
//
// En Cloudflare NUNCA se lee NODE_CLIENT_IP_HEADER: ahi lo podria mandar
// cualquier cliente.

export const NODE_CLIENT_IP_HEADER = "x-portaless-client-ip";
export const NODE_RUNTIME_MARKER = "node";

export function getClientIp(request: Request, env?: Record<string, unknown> | null): string | null {
  const header = env?.__PORTALESS_RUNTIME === NODE_RUNTIME_MARKER ? NODE_CLIENT_IP_HEADER : "CF-Connecting-IP";
  const value = request.headers.get(header)?.trim();
  return value ? value : null;
}
