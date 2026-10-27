// Public, secret-free MCP connection profile:
// GET /.well-known/portaless-mcp.json
//
// A hosted MCP client (ChatGPT, Claude, etc.) can fetch this document to
// discover the endpoint path, bearer-token contract, tool inventory and the
// HTTPS/tunnel requirement. It contains no tokens, API keys or private data.

import { buildMcpConnectionProfile } from "../../packages/mcp-server/src/interop/mcp-profile.ts";
import { publicOriginFromEnv } from "../_shared/public-origin.js";

export async function onRequestGet(context) {
  const { env } = context;
  const origin = publicOriginFromEnv(env);
  if (!origin) {
    return new Response(JSON.stringify({ error: "public_origin_not_configured" }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const profile = buildMcpConnectionProfile({ origin });
  return new Response(JSON.stringify(profile, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
