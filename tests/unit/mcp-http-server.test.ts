// packages/mcp-server/src/http.ts (nuevo): servidor HTTP stateless real
// (Opcion B -- identidad por invocacion via bearer token) arrancado en
// proceso sobre un puerto efimero, con round-trips JSON-RPC reales via
// fetch. Cubre el ciclo de vida completo exigido por el SDK en modo
// stateless (server+transport nuevos por peticion -- reusar el transporte
// lanza "Stateless transport cannot be reused across requests", bug que
// este test atrapa: initialize + segunda peticion deben pasar), el
// parsing del header Authorization, la verificacion de tokens por
// invocacion (dos tokens = dos identidades en el ledger) y los casos de
// error (sin bearer, token falso, ruta/metodo incorrectos).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { startMcpHttpServer, MCP_HTTP_PATH } from "../../packages/mcp-server/src/http";
import type { RunningMcpHttpServer } from "../../packages/mcp-server/src/http";
import {
  createMcpAgentTokenStore,
  __resetMcpAgentTokenStoreFactoryForTests,
} from "../../packages/mcp-server/src/permissions/agent-token-store";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";

interface McpJsonRpcResult {
  result?: {
    serverInfo?: { name: string };
    content?: Array<{ text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string }>;
  };
  error?: { code: number; message: string };
}

async function mcpPost(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: McpJsonRpcResult | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: McpJsonRpcResult | null = null;
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine) json = JSON.parse(dataLine.slice(6));
  else if (text.trim()) json = JSON.parse(text);
  return { status: res.status, json };
}

function toolText(json: McpJsonRpcResult | null): string {
  return json?.result?.content?.[0]?.text ?? "";
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

let running: RunningMcpHttpServer;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  __resetMcpAgentTokenStoreFactoryForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {}); // factories sin backend

  // Mismo env {} => el factory cachea UN InMemory store compartido entre
  // este test y el servidor (el servidor llama createMcpAgentTokenStore
  // con el mismo env dentro de startMcpHttpServer).
  const tokenStore = await createMcpAgentTokenStore({});
  tokenA = (await tokenStore.issue({ agentKeyId: "ed25519:http-a", displayName: "Agente HTTP A" })).token;
  tokenB = (await tokenStore.issue({ agentKeyId: "ed25519:http-b", displayName: "Agente HTTP B" })).token;

  running = await startMcpHttpServer({
    env: {},
    pageStore: { save: async (l: unknown) => l, load: async () => null } as never,
    permissionStore: new InMemoryPermissionStore(),
    pluginRegistry: { list: async () => [] } as never,
    auditLog: new InMemoryAuditLogStore(),
    usageLedger: new InMemoryUsageLedgerStore(),
  });
});

afterAll(async () => {
  await running?.close();
  __resetMcpAgentTokenStoreFactoryForTests();
  vi.restoreAllMocks();
});

describe("startMcpHttpServer -- transporte stateless Opcion B", () => {
  it("responde initialize y luego UNA SEGUNDA peticion (regla stateless: server+transport por request)", async () => {
    const first = await mcpPost(running.url, INIT, { authorization: `Bearer ${tokenA}` });
    expect(first.status).toBe(200);
    expect(first.json?.result?.serverInfo?.name).toBe("portaless-mcp-server");

    // Antes de arreglar el ciclo de vida, la segunda peticion moria con
    // 500 vacio ("Stateless transport cannot be reused across requests").
    const second = await mcpPost(
      running.url,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { authorization: `Bearer ${tokenA}` }
    );
    expect(second.status).toBe(200);
    expect(second.json?.result?.tools?.map((t) => t.name)).toContain("list_page_components");
  });

  it("list_page_components responde con el bearer del request", async () => {
    const { status, json } = await mcpPost(
      running.url,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_page_components", arguments: {} } },
      { authorization: `Bearer ${tokenA}` }
    );
    expect(status).toBe(200);
    expect(json?.result?.isError).toBeFalsy();
    expect(toolText(json)).toContain("Hero");
    expect(toolText(json)).toContain("StoreBlock");
  });

  it("dos tokens distintos = dos identidades separadas en el ledger (auditoria por invocacion)", async () => {
    const call = (id: number, bearer: string) =>
      mcpPost(
        running.url,
        { jsonrpc: "2.0", id, method: "tools/call", params: { name: "query_usage_log", arguments: {} } },
        { authorization: `Bearer ${bearer}` }
      );

    const a1 = await call(10, tokenA);
    expect(a1.status).toBe(200);
    expect(a1.json?.result?.isError).toBeFalsy();

    const b1 = await call(11, tokenB);
    expect(b1.json?.result?.isError).toBeFalsy();

    // Tercera llamada (como A): el ledger publico debe mostrar DOS
    // agentes distintos -- imposible con la identidad fija por proceso.
    const a2 = await call(12, tokenA);
    const ledger = JSON.parse(toolText(a2.json));
    const byId = Object.fromEntries(ledger.agents.map((agent: { operatorKeyId: string; requestsTotal: number }) => [agent.operatorKeyId, agent.requestsTotal]));
    expect(byId["ed25519:http-a"]).toBe(2);
    expect(byId["ed25519:http-b"]).toBe(1);
  });

  it("sin header Authorization: rechaza la petición MCP completa", async () => {
    const { status, json } = await mcpPost(running.url, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "query_usage_log", arguments: {} },
    });
    expect(status).toBe(401);
    expect(json).toEqual({ error: "unauthorized" });
  });

  it("con token desconocido: rechaza la petición antes del transporte", async () => {
    const { status, json } = await mcpPost(
      running.url,
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "query_usage_log", arguments: {} } },
      { authorization: "Bearer pless_mcp_desconocido" }
    );
    expect(status).toBe(401);
    expect(json).toEqual({ error: "unauthorized" });
  });

  it("ruta inexistente responde 404 con indicacion del path correcto", async () => {
    const res = await fetch(`http://${running.host}:${running.port}/otra`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found", message: expect.stringContaining(MCP_HTTP_PATH) });
  });

  it("GET sobre /mcp responde 405 (stateless solo acepta POST)", async () => {
    const res = await fetch(running.url);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("rechaza Host no autorizado y Origenes no permitidos antes del transporte MCP", async () => {
    const wrongHost = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port: running.port, path: MCP_HTTP_PATH, headers: { host: "attacker.example" } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(wrongHost.status).toBe(421);
    expect(JSON.parse(wrongHost.body)).toEqual({ error: "misdirected_request" });

    const wrongOrigin = await fetch(running.url, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify(INIT),
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("limita el tamaño del body y revoca el bearer para peticiones posteriores", async () => {
    const oversized = await mcpPost(running.url, { ...INIT, padding: "x".repeat(1024 * 1024) }, { authorization: `Bearer ${tokenA}` });
    expect(oversized.status).toBe(413);
    expect(oversized.json).toEqual({ error: "request_too_large" });

    const tokenStore = await createMcpAgentTokenStore({});
    await tokenStore.revoke("ed25519:http-b");
    const revoked = await mcpPost(running.url, INIT, { authorization: `Bearer ${tokenB}` });
    expect(revoked.status).toBe(401);
    expect(revoked.json).toEqual({ error: "unauthorized" });
  });
});
