# Interoperability: ChatGPT/MCP and OpenAI-compatible providers

This page records what is **verified locally**, what is **blocked on an external
account**, and what the repository does **not** claim.

Machine-readable evidence: [`interop-evidence.json`](./interop-evidence.json).
The registry is validated by `tests/unit/interop-evidence.test.ts`; a `passed`
row without a concrete account/client/model/evidence path fails the suite.

## C31 — MCP connection and authentication profile

Portaless publishes a secret-free profile at:

```text
GET /.well-known/portaless-mcp.json
```

It describes the Streamable HTTP endpoint (`/mcp`), bearer authentication,
per-invocation identity, the 19 registered tools, the local stdio/loopback
modes, and the HTTPS/tunnel requirement for hosted clients.

Local connection modes:

| Mode | Transport | Identity | Use |
|---|---|---|---|
| `stdio-local` | stdio | fixed `MCP_AGENT_KEY` per process | Claude Desktop/Cursor-style local process |
| `http-loopback` | Streamable HTTP | bearer token per invocation | local development at `127.0.0.1` |
| `https-reverse-proxy-or-tunnel` | Streamable HTTP | bearer token per invocation | hosted clients such as ChatGPT |

A public hosted client cannot reach a loopback-only server. Use an
operator-provided HTTPS reverse proxy or private tunnel (for example
Cloudflare Tunnel or ngrok) that terminates TLS and forwards to the loopback
MCP server. The exact tunnel is **not bundled** by this repository and no
specific tunnel is claimed as tested here.

Required HTTP environment:

```bash
PORTALESS_MCP_TRANSPORT=http
PORTALESS_MCP_HTTP_HOST=127.0.0.1
PORTALESS_MCP_HTTP_PORT=8788
PORTALESS_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com
PORTALESS_MCP_HTTP_ALLOWED_ORIGINS=https://chatgpt.com   # only if a browser Origin is used
```

The bearer token is issued once from `POST /admin/api/mcp-agents` and revoked
with `PATCH /admin/api/mcp-agents`. The profile endpoint never contains a token.

Known limits, also present in the profile document:

- stdio has one fixed identity per process; per-invocation identity requires HTTP;
- the HTTP credential is a bearer secret, not a per-request Ed25519 signature;
- ChatGPT account/workspace availability and write-capable custom MCP support
  are external to Portaless and must be verified with the exact account;
- clients may cache tool definitions; reconnect/refresh after deploying tools.

## C32 — OpenAI-compatible provider profile

The provider profile is an explicit, tested subset, not a claim of universal
compatibility. It lives in `packages/ai-provider/`.

Supported subset:

- `POST {baseUrl}/chat/completions`
- bearer API key held **server-side only**
- configurable HTTPS base URL and model
- non-streaming chat completions
- SSE text streaming
- non-streaming tool/function definitions and `tool_calls` parsing
- bounded timeout, caller cancellation and controlled errors

Not supported/claimed: streaming tool-call assembly, embeddings, images,
responses API, provider-specific extensions, and every endpoint of every
vendor.

Server-side configuration:

```bash
PORTALESS_OPENAI_API_KEY=...                 # never sent to browser code or MCP output
PORTALESS_OPENAI_BASE_URL=https://provider.example/v1
PORTALESS_OPENAI_MODEL=provider-model-name
PORTALESS_OPENAI_TIMEOUT_MS=30000            # 1000..120000
```

Check the active profile (admin only; never returns the key):

```text
GET /admin/api/ai-provider
```

The base URL must be HTTPS. Loopback HTTP is accepted only for local
development. Credentials in the URL, query strings and fragments are rejected.

Controlled error codes: `provider_http_error`, `provider_rate_limited`,
`provider_invalid_response`, `provider_timeout`, `provider_aborted`,
`provider_network_error`, `provider_stream_error`. Error objects do not carry
the API key or the provider response body.

An OpenAI API key is not a ChatGPT account/MCP credential. API billing and
product availability are separate.

## C33 — Acceptance evidence

### Local pass (executed)

`tests/unit/mcp-interop-acceptance.test.ts` runs the real MCP server and SDK
client end-to-end:

```text
connect
→ read authorized context
→ edit a block
→ save a draft proposal
→ review the diff
→ approve the exact revision
→ read the published revision
```

Local evidence row: `local-mcp-sdk-client` in
[`interop-evidence.json`](./interop-evidence.json).

`tests/unit/ai-provider-openai-compatible.test.ts` runs the provider contract
against a local fake endpoint with model `test-model`: request shape, server-side
key, tool calls, SSE streaming, 429/5xx mapping, timeout and cancellation.

### External rows (not executed here)

| Target | Status | Why |
|---|---|---|
| ChatGPT Desktop/Web custom MCP | **blocked_unverified** | No external ChatGPT account/workspace and HTTPS tunnel were available. Account, plan, client version, model and tool-discovery snapshot must be recorded from a real run. |
| External OpenAI-compatible provider | **not_run** | Requires a real user-supplied API key, named endpoint and model. |

Do not change these rows to `passed` without the evidence fields required by
`tests/unit/interop-evidence.test.ts`.

## How to run the local checks

```bash
node node_modules/vitest/vitest.mjs run \
  tests/unit/mcp-profile.test.ts \
  tests/unit/mcp-interop-acceptance.test.ts \
  tests/unit/ai-provider-openai-compatible.test.ts \
  tests/unit/admin-ai-provider-endpoint.test.ts \
  tests/unit/interop-evidence.test.ts
```

For a real external acceptance run, record the exact account/workspace plan,
client and model, the HTTPS/tunnel origin, tool-discovery snapshot, request ids,
and the full flow result in `interop-evidence.json`.
