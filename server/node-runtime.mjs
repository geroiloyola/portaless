import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createSafeFetcher } from "../packages/apw-resolver/src/federation/safe-fetch.ts";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

// APW v1.2 (B8): IP del cliente en self-host. El runtime descarta cualquier
// header de IP que mande el cliente (se podria falsificar) y escribe
// CLIENT_IP_HEADER con la IP calculada. getClientIp()
// (packages/trust-layer/src/net/client-ip.ts) lo lee solo cuando
// env.__PORTALESS_RUNTIME === "node".
export const CLIENT_IP_HEADER = "x-portaless-client-ip";
const SPOOFABLE_IP_HEADERS = new Set(["cf-connecting-ip", "true-client-ip", CLIENT_IP_HEADER]);

function normalizeIp(ip) { if (!ip) return ""; const value = String(ip).trim(); return value.startsWith("::ffff:") ? value.slice(7) : value; }
export function parseTrustedProxies(value) { return String(value || "").split(",").map(normalizeIp).filter(Boolean); }

// X-Forwarded-For solo cuenta si la conexion viene de un proxy confiable
// (coincidencia exacta de IP, sin rangos). Se recorre de derecha a
// izquierda salteando proxies confiables: la primera IP no confiable es el
// cliente. Sin proxies configurados, siempre la IP del socket.
export function resolveClientIp(socketIp, forwardedFor, trustedProxies = []) {
  const remote = normalizeIp(socketIp);
  if (!remote) return null;
  if (!trustedProxies.length || !trustedProxies.includes(remote)) return remote;
  const chain = String(forwardedFor || "").split(",").map(normalizeIp).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) { if (!trustedProxies.includes(chain[i])) return chain[i]; }
  return remote;
}

// B5: el safe-fetcher resuelve y valida una IP; este transporte se conecta a
// ESA IP (lookup pinneado) manteniendo el hostname para Host/SNI. Sin esto,
// `fetch` volveria a resolver y un DNS rebinding entre ambas resoluciones
// podria saltarse la validacion.
export function createPinnedFetch(requestImpl = httpsRequest) {
  return (url, init = {}, address) => new Promise((resolvePromise, reject) => {
    if (!address) {
      reject(new Error("missing_pinned_address"));
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("invalid_url"));
      return;
    }
    if (parsed.protocol !== "https:") {
      reject(new Error("invalid_url"));
      return;
    }

    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    const req = requestImpl(parsed, {
      method: init.method || "GET",
      headers,
      signal: init.signal,
      // Keep certificate identity tied to the URL, never to the pinned IP.
      servername: isIP(parsed.hostname.replace(/^\[|\]$/g, "")) ? undefined : parsed.hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_servername, cert) => checkServerIdentity(parsed.hostname.replace(/^\[|\]$/g, ""), cert),
      lookup: (_hostname, _options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (_options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (res) => {
      const status = res.statusCode || 502;
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
        else if (value !== undefined) responseHeaders.set(key, value);
      }
      // 3xx/4xx/5xx: el safe-fetcher solo necesita status y Location; no se
      // deja un body abierto ni se bufferiza para descartarlo.
      if (status < 200 || status >= 300) {
        res.resume();
        resolvePromise(new Response(null, { status, headers: responseHeaders }));
        return;
      }
      resolvePromise(new Response(Readable.toWeb(res), { status, headers: responseHeaders }));
    });
    req.on("error", reject);
    req.end();
  });
}

function walk(dir) { if (!existsSync(dir)) return []; return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const path = join(dir, entry.name); return entry.isDirectory() ? walk(path) : [path]; }); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function routeFromFile(functionsDir, file) { const relativePath = relative(functionsDir, file).split(sep); const last = relativePath.pop(); const stem = last.replace(/\.js$/, ""); if (stem !== "index") relativePath.push(stem); const segments = relativePath.filter(Boolean); const keys = []; const pattern = "^/" + segments.map((segment) => { const match = segment.match(/^\[([^/]+)\]$/); if (match) { keys.push(match[1]); return "([^/]+)"; } return escapeRegex(segment); }).join("/") + "/?$"; return { pathname: "/" + segments.join("/"), keys, matcher: new RegExp(pattern) }; }
function middlewarePrefix(functionsDir, file) { const parts = relative(functionsDir, file).split(sep); parts.pop(); return "/" + parts.filter(Boolean).join("/"); }
function isPrefix(pathname, prefix) { return prefix === "/" || pathname === prefix || pathname.startsWith(prefix + "/"); }
function methodHandler(module, method) { const suffix = method[0] + method.slice(1).toLowerCase(); return module[`onRequest${suffix}`] || module.onRequest || null; }
function requestFromNode(req, trustedProxies = []) { const origin = `http://${req.headers.host || "localhost"}`; const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) { if (SPOOFABLE_IP_HEADERS.has(key.toLowerCase())) continue; if (Array.isArray(value)) value.forEach((item) => headers.append(key, item)); else if (value !== undefined) headers.set(key, value); } const clientIp = resolveClientIp(req.socket?.remoteAddress, req.headers["x-forwarded-for"], trustedProxies); if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp); const hasBody = !["GET", "HEAD"].includes(req.method || "GET"); return new Request(new URL(req.url || "/", origin), { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? "half" : undefined }); }
async function sendNodeResponse(response, res) { res.statusCode = response.status; res.statusMessage = response.statusText || res.statusMessage; for (const [key, value] of response.headers) res.setHeader(key, value); const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []; if (setCookies.length) res.setHeader("set-cookie", setCookies); if (!response.body) return res.end(); res.end(Buffer.from(await response.arrayBuffer())); }
// Paridad con Cloudflare Pages: si una Function no exporta handler para el metodo,
// Pages continua hacia los assets estaticos. Solo se cae al estatico si el archivo
// existe de verdad (no el fallback 404.html).
function staticFileExists(staticDir, pathname) { let decoded; try { decoded = decodeURIComponent(pathname); } catch { return false; } const root = resolve(staticDir); const candidate = resolve(staticDir, "." + decoded); if (candidate !== root && !candidate.startsWith(root + sep)) return false; if (!existsSync(candidate)) return false; const stat = statSync(candidate); return stat.isFile() || (stat.isDirectory() && existsSync(join(candidate, "index.html"))); }
// La pagina 404.html de Astro se sirve con status 404 (igual que Cloudflare Pages), no 200.
function staticResponse(staticDir, pathname) { let decoded; try { decoded = decodeURIComponent(pathname); } catch { return new Response("Bad Request", { status: 400 }); } const candidate = resolve(staticDir, "." + decoded); const root = resolve(staticDir); if (candidate !== root && !candidate.startsWith(root + sep)) return new Response("Forbidden", { status: 403 }); const file = existsSync(candidate) && statSync(candidate).isDirectory() ? join(candidate, "index.html") : candidate; const isNotFoundPage = !existsSync(file) && !decoded.includes("."); const fallback = isNotFoundPage ? join(root, "404.html") : file; if (!existsSync(fallback) || !statSync(fallback).isFile()) return new Response("Not Found", { status: 404 }); const extension = fallback.slice(fallback.lastIndexOf(".")); return new Response(readFileSync(fallback), { status: isNotFoundPage ? 404 : 200, headers: { "content-type": MIME[extension] || "application/octet-stream" } }); }

// PR H: binding env.ASSETS, equivalente al de Cloudflare Pages. Sin esto,
// loadContentPolicy(origin, env.ASSETS) en functions/_middleware.js no tenia
// como leer /.well-known/portaless-content-policy.json en self-host y caia
// siempre en la politica por defecto: el manifiesto del dueno se ignoraba.
// Solo GET/HEAD, igual que los estaticos; misma proteccion contra traversal
// que staticResponse().
export function createAssetsBinding(staticDir) {
  return {
    async fetch(input, init) {
      const isRequest = typeof Request !== "undefined" && input instanceof Request;
      const url = new URL(isRequest ? input.url : String(input), "http://localhost");
      const method = String(init?.method || (isRequest ? input.method : "GET")).toUpperCase();
      if (method !== "GET" && method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      return staticResponse(staticDir, url.pathname);
    },
  };
}

// Se expone con un Proxy para no mutar process.env (sus valores son siempre
// strings) y para que el resto de las variables se siga leyendo en vivo.
// Si la plataforma ya trae su propio ASSETS, se respeta. APW v1.2: marca el
// runtime y expone lookup DNS solo al self-host para guards anti-SSRF.
function withRuntimeBindings(env, assets, directoryFetcher) {
  const dnsLookupAll = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((address) => address.address);
  return new Proxy(env, {
    get: (target, key, receiver) => {
      if (key === "__PORTALESS_RUNTIME") return "node";
      if (key === "__PORTALESS_DNS_LOOKUP") return dnsLookupAll;
      if (key === "__PORTALESS_DIRECTORY_FETCHER") return directoryFetcher;
      if (key === "ASSETS") return target.ASSETS || assets;
      return Reflect.get(target, key, receiver);
    },
    has: (target, key) => key === "ASSETS" || key === "__PORTALESS_RUNTIME" || key === "__PORTALESS_DNS_LOOKUP" || key === "__PORTALESS_DIRECTORY_FETCHER" || Reflect.has(target, key),
  });
}

export async function createSelfHostServer(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd()); const functionsDir = resolve(options.functionsDir || join(rootDir, "functions")); const staticDir = resolve(options.staticDir || join(rootDir, "dist")); const env = options.env || process.env;
  const directoryFetcher = createSafeFetcher({
    lookup: async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((address) => address.address),
    fetchPinned: createPinnedFetch(),
  });
  const runtimeEnv = withRuntimeBindings(env, createAssetsBinding(staticDir), directoryFetcher);
  const trustedProxies = parseTrustedProxies(env.PORTALESS_TRUSTED_PROXIES);
  const sourceFiles = walk(functionsDir).filter((file) => file.endsWith(".js"));
  const handlers = sourceFiles.filter((file) => !file.endsWith(`${sep}_middleware.js`)).map((file) => ({ file, ...routeFromFile(functionsDir, file) }));
  const middlewares = sourceFiles.filter((file) => file.endsWith(`${sep}_middleware.js`) || file.endsWith("/_middleware.js")).map((file) => ({ file, prefix: middlewarePrefix(functionsDir, file) })).sort((a, b) => a.prefix.length - b.prefix.length);
  const modules = new Map(); const load = async (file) => { if (!modules.has(file)) modules.set(file, import(pathToFileURL(file).href)); return modules.get(file); };
  // El dispatch usa UN SOLO objeto context por peticion (semantica de
// Cloudflare Pages): los middlewares pueden mutar c.data.x o reasignar
// c.data = {...} y el handler ve el resultado. Antes cada middleware
// recibia un literal nuevo, la reasignacion del admin middleware
// (context.data = { user }) se perdia y TODOS los endpoints
// autenticados de /admin/* devolvian 401 en self-host.
const maxConcurrentRequests = Number(env.PORTALESS_MAX_CONCURRENT_REQUESTS || 64);
let activeRequests = 0;
return createServer(async (req, res) => {
  if (Number.isInteger(maxConcurrentRequests) && maxConcurrentRequests > 0 && activeRequests >= maxConcurrentRequests) {
    return sendNodeResponse(Response.json({ error: "server_busy" }, { status: 503, headers: { "retry-after": "1" } }), res);
  }
  activeRequests += 1;
  try { const request = requestFromNode(req, trustedProxies); const url = new URL(request.url); if (url.pathname === "/healthz") return sendNodeResponse(Response.json({ ok: true, runtime: "portaless-node", sqlite: Boolean(env.PORTALESS_SQLITE_PATH) }), res); const route = handlers.find((entry) => entry.matcher.test(url.pathname)); const activeMiddleware = middlewares.filter((entry) => isPrefix(url.pathname, entry.prefix)); const data = {}; const params = {}; if (route) { const match = url.pathname.match(route.matcher); route.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); }); } const context = { request, env: runtimeEnv, params, data, next: null }; const finish = async () => { context.next = () => staticResponse(staticDir, url.pathname); if (!route) return context.next(); const module = await load(route.file); const handler = methodHandler(module, request.method); if (!handler) { if (staticFileExists(staticDir, url.pathname)) return staticResponse(staticDir, url.pathname); const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].filter((method) => methodHandler(module, method)); return new Response("Method Not Allowed", { status: 405, headers: { allow: allowed.join(", ") } }); } return handler(context); }; let middlewareIndex = 0; context.next = async () => { if (middlewareIndex >= activeMiddleware.length) return finish(); const entry = activeMiddleware[middlewareIndex++]; const module = await load(entry.file); if (typeof module.onRequest !== "function") throw new Error(`Middleware sin onRequest: ${entry.file}`); return module.onRequest(context); }; return sendNodeResponse(await context.next(), res); } catch (error) { console.error("[Portaless Node Runtime]", error); return sendNodeResponse(Response.json({ error: "internal_server_error" }, { status: 500 }), res); } finally { activeRequests -= 1; } });
}
export async function startSelfHostServer(options = {}) { const env = options.env || process.env; if (!env.PORTALESS_SQLITE_PATH) throw new Error("PORTALESS_SQLITE_PATH es obligatoria para iniciar Portaless self-hosted."); const server = await createSelfHostServer(options); const port = Number(env.PORT || 3000); const host = env.HOST || "0.0.0.0"; await new Promise((ok, fail) => { server.once("error", fail); server.listen(port, host, ok); }); console.log(`Portaless self-hosted escuchando en http://${host}:${port}`); return server; }
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) startSelfHostServer().catch((error) => { console.error("No se pudo iniciar Portaless:", error.message); process.exit(1); });
