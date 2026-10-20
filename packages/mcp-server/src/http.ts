// Servidor HTTP stateless del mcp-server (transporte Opcion B --
// identidad de agente por invocacion via bearer token). Separado de
// index.ts para poder probarlo en proceso (tests/unit/mcp-http-server.test.ts),
// que arranca este servidor real en un puerto efimero y hace round-trips
// JSON-RPC reales con/sin Authorization.
//
// Regla de ciclo de vida (SDK @modelcontextprotocol, ver ejemplo oficial
// simpleStatelessStreamableHttp): en modo stateless CADA peticion necesita
// server + transport NUEVOS -- reusar un transporte stateless lanza
// "Stateless transport cannot be reused across requests". Los stores son
// compartidos entre requests (solo se construye la instancia del servidor
// con sus tools), y el cleanup se hace en res.on("close") cuando el stream
// de respuesta termina.

import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPortalessMcpServer } from "./server.js";
import type { McpStoreDeps } from "./server.js";
import {
  createBearerTokenAgentIdentityResolver,
  extractBearerToken,
} from "./permissions/agent-identity.js";
import {
  createMcpAgentTokenStore,
  type McpAgentTokenStoreFactoryEnv,
} from "./permissions/agent-token-store.js";
import { MCP_HTTP_PATH } from "./metadata.js";

export { MCP_HTTP_PATH } from "./metadata.js";

export interface StartMcpHttpServerOptions extends McpStoreDeps {
  env: McpAgentTokenStoreFactoryEnv;
  /** 0 (default) = puerto efimero asignado por el SO; util en tests. */
  port?: number;
  host?: string;
  /** Hostnames accepted in the Host header. Required for non-loopback binds. */
  allowedHosts?: string[];
  /** Exact browser Origins permitted to call the endpoint; empty by default. */
  allowedOrigins?: string[];
  requestsPerMinute?: number;
  maxConcurrentRequests?: number;
  maxRequestBodyBytes?: number;
}

export interface RunningMcpHttpServer {
  server: HttpServer;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

export async function startMcpHttpServer(
  options: StartMcpHttpServerOptions
): Promise<RunningMcpHttpServer> {
  const {
    env, port = 0, host = "127.0.0.1", allowedHosts, allowedOrigins = [],
    requestsPerMinute = 120, maxConcurrentRequests = 32, maxRequestBodyBytes = 1024 * 1024,
    ...stores
  } = options;
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  const hostAllowlist = (allowedHosts ?? (loopback ? [host, "localhost", "127.0.0.1", "::1"] : [])).map(normalizeHostname);
  if (hostAllowlist.length === 0) throw new Error("MCP HTTP on a non-loopback interface requires an explicit allowedHosts allowlist.");
  const originAllowlist = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  const rateLimit = new IpRateLimiter(requestsPerMinute);
  if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) throw new Error("maxConcurrentRequests must be a positive integer.");
  if (!Number.isInteger(maxRequestBodyBytes) || maxRequestBodyBytes < 1) throw new Error("maxRequestBodyBytes must be a positive integer.");

  const tokenStore = await createMcpAgentTokenStore(env);
  const resolveAgent = createBearerTokenAgentIdentityResolver(tokenStore);
  let activeRequests = 0;

  const httpServer = createHttpServer((req, res) => {
    if (activeRequests >= maxConcurrentRequests) {
      res.writeHead(503, { "content-type": "application/json", "retry-after": "1" });
      res.end(JSON.stringify({ error: "server_busy" }));
      return;
    }
    activeRequests += 1;
    void handleRequest(req, res, stores, resolveAgent, tokenStore, hostAllowlist, originAllowlist, rateLimit, maxRequestBodyBytes)
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        } else if (!res.writableEnded) res.end();
      })
      .finally(() => { activeRequests -= 1; });
  });
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 30_000;
  httpServer.maxHeadersCount = 50;

  await new Promise<void>((ok, fail) => {
    httpServer.once("error", fail);
    httpServer.listen(port, host, ok);
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    server: httpServer,
    port: boundPort,
    host,
    url: `http://${host}:${boundPort}${MCP_HTTP_PATH}`,
    close: () =>
      new Promise<void>((ok, fail) => {
        httpServer.close((err) => (err ? fail(err) : ok()));
        httpServer.closeAllConnections?.();
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  stores: McpStoreDeps,
  resolveAgent: Parameters<typeof createPortalessMcpServer>[0]["resolveAgent"],
  tokenStore: Awaited<ReturnType<typeof createMcpAgentTokenStore>>,
  allowedHosts: string[],
  allowedOrigins: Set<string>,
  rateLimit: IpRateLimiter,
  maxRequestBodyBytes: number,
): Promise<void> {
  const rawHost = req.headers.host;
  if (!rawHost || !allowedHosts.includes(normalizeHostname(rawHost))) {
    res.writeHead(421, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "misdirected_request" }));
    return;
  }
  const origin = req.headers.origin;
  if (origin && (!allowedOrigins.has(origin) || origin === "null")) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "origin_not_allowed" }));
    return;
  }
  if (!rateLimit.allow(req.socket.remoteAddress ?? "unknown")) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== MCP_HTTP_PATH) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", message: `El endpoint MCP esta en ${MCP_HTTP_PATH}.` }));
    return;
  }
  if (req.method !== "POST") {
    // Stateless: no hay stream SSE inicializado (GET) ni sesion que
    // cerrar (DELETE); el transporte solo acepta POST.
    res.writeHead(405, { "content-type": "application/json", allow: "POST" });
    res.end(JSON.stringify({ error: "method_not_allowed", message: `Solo POST sobre ${MCP_HTTP_PATH} (stateless).` }));
    return;
  }

  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request_too_large" }));
    req.resume();
    return;
  }

  // Adjunta el bearer token crudo como req.auth: el transporte lo propaga
  // como extra.authInfo a cada tool, y el resolver lo VERIFICA por
  // invocacion. El endpoint autentica todas las peticiones POST, incluso
  // initialize y tools/list; el resolver vuelve a verificar cada tool call.
  const rawBearer = extractBearerToken(req.headers.authorization);
  if (!rawBearer || !(await tokenStore.verify(rawBearer))) {
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  (req as unknown as { auth?: { token: string; clientId: string; scopes: string[] } }).auth = {
    token: rawBearer,
    clientId: "",
    scopes: [],
  };

  // Server + transport nuevos por peticion (regla stateless del SDK).
  try {
    const server: McpServer = createPortalessMcpServer({ ...stores, resolveAgent });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: maxRequestBodyBytes });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch {
    // Un fallo del transporte no debe quedar como 500 vacio: se loguea
    // antes de responder, para que el operador vea la causa real.
    console.error("[portaless-mcp-server] MCP HTTP request failed.");
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error" }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

function normalizeHostname(raw: string): string {
  try {
    const parsed = new URL(`http://${raw}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/") return "";
    return parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

class IpRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("requestsPerMinute must be a positive integer.");
  }
  allow(ip: string): boolean {
    const now = Date.now();
    let window = this.windows.get(ip);
    if (!window || now - window.startedAt >= this.windowMs) {
      window = { startedAt: now, count: 0 };
      this.windows.set(ip, window);
    }
    window.count += 1;
    if (this.windows.size > 4096) {
      for (const [key, value] of this.windows) if (now - value.startedAt >= this.windowMs) this.windows.delete(key);
    }
    return window.count <= this.limit;
  }
}
