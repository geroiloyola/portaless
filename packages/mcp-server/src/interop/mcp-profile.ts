// Public, secret-free metadata for connecting an MCP client (ChatGPT,
// Claude, Cursor, ...) to a Portaless deployment. It describes the transport,
// authentication contract, tool inventory and the conditions under which a
// public hosted client can reach the endpoint.
//
// This is metadata only. It never contains a bearer token, API key or any
// other credential.

import { MCP_HTTP_PATH, MCP_TOOL_NAMES, SERVER_NAME, SERVER_VERSION } from "../metadata.js";

export const MCP_PROFILE_TYP = "portaless-mcp-profile";
export const MCP_PROFILE_VERSION = "1.0";

export type McpConnectionModeId =
  | "stdio-local"
  | "http-loopback"
  | "https-reverse-proxy-or-tunnel";

export interface McpConnectionMode {
  id: McpConnectionModeId;
  transport: "stdio" | "streamable-http";
  requiresPublicHttps: boolean;
  perInvocationIdentity: boolean;
  notes: string;
}

export interface McpConnectionProfile {
  typ: typeof MCP_PROFILE_TYP;
  version: typeof MCP_PROFILE_VERSION;
  server: {
    name: string;
    version: string;
    protocol: "mcp";
  };
  endpoint: {
    path: string;
    url: string;
    transport: "streamable-http";
    stateless: true;
  };
  authentication: {
    scheme: "bearer";
    header: "Authorization";
    format: "Bearer <token>";
    issuance: "/admin/api/mcp-agents";
    revocation: "PATCH /admin/api/mcp-agents";
    perInvocation: true;
    stdio: {
      mode: "fixed-environment-identity";
      perInvocation: false;
    };
  };
  transportSecurity: {
    publicHttpsRequired: true;
    secure: boolean;
    loopbackHttpAllowed: boolean;
    tunnel: "operator-provided-https-reverse-proxy";
  };
  toolCount: number;
  tools: string[];
  connectionModes: McpConnectionMode[];
  warnings: string[];
  limitations: string[];
}

export interface BuildMcpConnectionProfileInput {
  origin: string;
  toolNames?: readonly string[];
  serverVersion?: string;
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * A hosted MCP client needs a publicly trusted HTTPS origin (or an HTTPS
 * tunnel that terminates TLS in front of the loopback server). Plain HTTP is
 * only accepted for loopback development.
 */
export function isSecureMcpOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

export function buildMcpConnectionProfile(input: BuildMcpConnectionProfileInput): McpConnectionProfile {
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    throw new Error("invalid_mcp_origin_scheme");
  }
  const loopback = isLoopbackHostname(origin.hostname);
  const secure = origin.protocol === "https:" || loopback;
  const tools = [...(input.toolNames ?? MCP_TOOL_NAMES)];
  const endpoint = new URL(MCP_HTTP_PATH, origin);

  const warnings: string[] = [];
  if (!secure) warnings.push("public_mcp_requires_https_or_supported_tunnel");

  return {
    typ: MCP_PROFILE_TYP,
    version: MCP_PROFILE_VERSION,
    server: {
      name: SERVER_NAME,
      version: input.serverVersion ?? SERVER_VERSION,
      protocol: "mcp",
    },
    endpoint: {
      path: MCP_HTTP_PATH,
      url: endpoint.toString(),
      transport: "streamable-http",
      stateless: true,
    },
    authentication: {
      scheme: "bearer",
      header: "Authorization",
      format: "Bearer <token>",
      issuance: "/admin/api/mcp-agents",
      revocation: "PATCH /admin/api/mcp-agents",
      perInvocation: true,
      stdio: {
        mode: "fixed-environment-identity",
        perInvocation: false,
      },
    },
    transportSecurity: {
      publicHttpsRequired: true,
      secure,
      loopbackHttpAllowed: true,
      tunnel: "operator-provided-https-reverse-proxy",
    },
    toolCount: tools.length,
    tools,
    connectionModes: [
      {
        id: "stdio-local",
        transport: "stdio",
        requiresPublicHttps: false,
        perInvocationIdentity: false,
        notes: "Local child process; identity is fixed from MCP_AGENT_KEY for the process lifetime.",
      },
      {
        id: "http-loopback",
        transport: "streamable-http",
        requiresPublicHttps: false,
        perInvocationIdentity: true,
        notes: "Development only: bind 127.0.0.1 and send Authorization: Bearer on every POST.",
      },
      {
        id: "https-reverse-proxy-or-tunnel",
        transport: "streamable-http",
        requiresPublicHttps: true,
        perInvocationIdentity: true,
        notes: "Required for hosted clients such as ChatGPT: terminate TLS in an operator-provided tunnel or reverse proxy and allowlist the public Host.",
      },
    ],
    warnings,
    limitations: [
      "stdio exposes one fixed agent identity per process; per-invocation identity requires HTTP.",
      "The HTTP credential is a bearer token, not an Ed25519 signature per request.",
      "ChatGPT account/workspace availability and write-capable custom MCP support are external to Portaless and must be verified with the exact account.",
      "MCP clients may cache the tool inventory; refresh/reconnect after deploying new tools.",
    ],
  };
}
