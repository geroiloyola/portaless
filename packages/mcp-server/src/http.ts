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

export const MCP_HTTP_PATH = "/mcp";

export interface StartMcpHttpServerOptions extends McpStoreDeps {
  env: McpAgentTokenStoreFactoryEnv;
  /** 0 (default) = puerto efimero asignado por el SO; util en tests. */
  port?: number;
  host?: string;
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
  const { env, port = 0, host = "127.0.0.1", ...stores } = options;

  const tokenStore = await createMcpAgentTokenStore(env);
  const resolveAgent = createBearerTokenAgentIdentityResolver(tokenStore);

  const httpServer = createHttpServer((req, res) => {
    void handleRequest(req, res, stores, resolveAgent);
  });

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
  resolveAgent: Parameters<typeof createPortalessMcpServer>[0]["resolveAgent"]
): Promise<void> {
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

  // Adjunta el bearer token crudo como req.auth: el transporte lo propaga
  // como extra.authInfo a cada tool, y el resolver lo VERIFICA por
  // invocacion (unico punto de verdad -- aqui NO se verifica, para que la
  // capa de herramientas sea la misma en tests directos y en produccion).
  // Sin header: req.auth queda ausente y el resolver lanza
  // AgentIdentityError(missing_token).
  const rawBearer = extractBearerToken(req.headers.authorization);
  if (rawBearer) {
    (req as unknown as { auth?: { token: string; clientId: string; scopes: string[] } }).auth = {
      token: rawBearer,
      clientId: "",
      scopes: [],
    };
  }

  // Server + transport nuevos por peticion (regla stateless del SDK).
  try {
    const server: McpServer = createPortalessMcpServer({ ...stores, resolveAgent });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (err) {
    // Un fallo del transporte no debe quedar como 500 vacio: se loguea
    // antes de responder, para que el operador vea la causa real.
    console.error("[portaless-mcp-server] Error manejando POST /mcp:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
