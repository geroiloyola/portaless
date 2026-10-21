# OpenAI-compatible provider: connection guide

> **Status: explicit subset, implemented and contract-tested locally.** External
> providers remain **`not_run`** until the same contract is executed against a
> real key, endpoint and model. This is not a universal "100% OpenAI compatible"
> claim.

## What this is — and what it is not

`@portaless/ai-provider` is a **server-side provider profile** for Portaless
code that needs to call an OpenAI-compatible `POST {baseUrl}/chat/completions`
endpoint. It supports a deliberately narrow subset:

- bearer API key held server-side only;
- configurable HTTPS base URL and model;
- non-streaming chat completions;
- SSE text streaming;
- non-streaming tool/function definitions and `tool_calls` parsing;
- bounded timeout, caller cancellation and sanitized errors.

It does **not** claim streaming tool-call assembly, embeddings, image
generation, the Responses API, provider-specific extensions, or compatibility
with every endpoint of every vendor.

This provider is **not** the ChatGPT/MCP connection. MCP is how an AI client
edits Portaless pages; the provider profile is how Portaless-side code calls a
model. An OpenAI API key and a ChatGPT account/MCP connection are different
credentials with different billing and availability.

## Configure

Set these on the server (Node/self-host or Cloudflare), never in browser code
and never in an MCP tool response:

```bash
PORTALESS_OPENAI_API_KEY=...                 # required, server-side only
PORTALESS_OPENAI_BASE_URL=https://provider.example/v1
PORTALESS_OPENAI_MODEL=provider-model-name
PORTALESS_OPENAI_TIMEOUT_MS=30000            # optional, 1000..120000
```

Rules:

- The base URL must be `https://`.
- `http://` is accepted only for loopback development
  (`localhost`, `127.0.0.1`, `::1`).
- Credentials in the URL, query strings and fragments are rejected.
- Partial configuration fails closed with explicit `errors`; it never invents a
  model or endpoint.
- Keep the key in the platform secret store. Do not commit it, log it, or expose
  it through `GET /admin/api/ai-provider`.

## Verify the active profile

With an authenticated admin session:

```text
GET /admin/api/ai-provider
```

The response reports `{ enabled, profile, errors }`. The profile contains the
endpoint, model and supported capabilities; the API key is represented only as
`"server-side"`. A missing configuration returns `enabled: false` and no errors.

## Minimal local connection check

This verifies the HTTP path and the server-side bearer handling without a real
vendor account. It uses only Python's standard library.

`mock.py`:

```python
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.dumps({
            "id": "chatcmpl-mock", "object": "chat.completion",
            "created": 0, "model": "mock",
            "choices": [{"index": 0, "message": {
                "role": "assistant", "content": "OK"
            }, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("127.0.0.1", 8000), H).serve_forever()
```

Run it in one terminal:

```bash
python3 mock.py
```

In another terminal, from the repository root:

```bash
PORTALESS_OPENAI_API_KEY=cualquiera \
PORTALESS_OPENAI_BASE_URL=http://127.0.0.1:8000/v1 \
PORTALESS_OPENAI_MODEL=mock \
node --import tsx --input-type=module <<'JS'
import { loadOpenAICompatibleConfig, createOpenAICompatibleProvider } from "./packages/ai-provider/src/index.ts";

const loaded = loadOpenAICompatibleConfig(process.env);
if (!loaded.enabled) {
  console.error(loaded.errors);
  process.exit(1);
}
const provider = createOpenAICompatibleProvider(loaded.config);
const result = await provider.complete([{ role: "user", content: "ping" }]);
console.log(JSON.stringify({ model: result.model, content: result.content, usage: result.usage }));
JS
```

Expected result: `"content": "OK"`, model `mock`, usage `1/1/2`.

The mock accepts any bearer value; it proves the request/response path, not
authentication semantics. To prove the header is sent, use a mock that returns
`401` unless `Authorization: Bearer cualquiera` is present.

## Use from code

```js
import {
  loadOpenAICompatibleConfig,
  createOpenAICompatibleProvider,
} from "@portaless/ai-provider";

const loaded = loadOpenAICompatibleConfig(process.env);
if (!loaded.enabled) throw new Error(loaded.errors.join("; "));

const provider = createOpenAICompatibleProvider(loaded.config);
const result = await provider.complete([
  { role: "user", content: "Summarize this page." },
]);

console.log(result.content);
```

Use `provider.stream(messages)` only when the endpoint really emits SSE text
deltas. Do not assume streaming tool calls; that capability is intentionally
reported as `false`.

## External acceptance — what is still missing

The external row in
[`testing/INTEROPERABILITY.md`](./testing/INTEROPERABILITY.md) remains
**`not_run`** for every third-party endpoint. To move one provider to
`passed`, record at least:

- provider name and exact base URL;
- exact model identifier;
- date and operator;
- chat completion result;
- SSE streaming result, if used;
- tool/function call result, if used;
- timeout/cancellation behavior;
- request identifiers or another reproducible trace.

Record the result in
[`testing/interop-evidence.json`](./testing/interop-evidence.json). Do not
change the status to `passed` without that evidence.

For the separate MCP/ChatGPT connection path, see
[`testing/INTEROPERABILITY.md`](./testing/INTEROPERABILITY.md#c31--mcp-connection-and-authentication-profile)
and [`architecture/mcp-agents.md`](./architecture/mcp-agents.md).
