// Public, secret-free MCP connection profile:
// GET /.well-known/portaless-mcp.json
//
// A hosted MCP client (ChatGPT, Claude, etc.) can fetch this document to
// discover the endpoint path, bearer-token contract, tool inventory and the
// HTTPS/tunnel requirement. It contains no tokens, API keys or private data.

import { buildMcpConnectionProfile } from "../../packages/mcp-server/src/interop/mcp-profile.ts";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const profile = buildMcpConnectionProfile({
    origin: `${url.protocol}//${url.host}`,
  });
  return new Response(JSON.stringify(profile, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
