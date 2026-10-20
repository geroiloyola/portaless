import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  createOpenAICompatibleProvider,
  loadOpenAICompatibleConfig,
  normalizeProviderBaseUrl,
} from "../../packages/ai-provider/src/index";

const MESSAGES = [{ role: "user" as const, content: "Hola" }];

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("OpenAI-compatible provider profile", () => {
  it("is disabled without configuration", () => {
    expect(loadOpenAICompatibleConfig({})).toEqual({ enabled: false, config: null, profile: null, errors: [] });
  });

  it("requires a key and model, and rejects unsafe public HTTP base URLs", () => {
    const missing = loadOpenAICompatibleConfig({ PORTALESS_OPENAI_BASE_URL: "https://provider.test/v1" });
    expect(missing.enabled).toBe(false);
    expect(missing.errors).toEqual(expect.arrayContaining([
      "PORTALESS_OPENAI_API_KEY is required",
      "PORTALESS_OPENAI_MODEL is required",
    ]));

    expect(normalizeProviderBaseUrl("http://provider.test/v1")).toBeNull();
    expect(normalizeProviderBaseUrl("https://user:pass@provider.test/v1")).toBeNull();
    expect(normalizeProviderBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
  });

  it("returns a server-side profile without the API key", () => {
    const result = loadOpenAICompatibleConfig({
      PORTALESS_OPENAI_API_KEY: "sk-test-secret",
      PORTALESS_OPENAI_BASE_URL: "https://provider.test/v1/",
      PORTALESS_OPENAI_MODEL: "test-model",
    });
    expect(result.enabled).toBe(true);
    expect(result.profile).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://provider.test/v1",
      model: "test-model",
      apiKey: "server-side",
      capabilities: { chatCompletions: true, streaming: true, toolCalls: true, streamingToolCalls: false },
    });
    expect(JSON.stringify(result.profile)).not.toContain("sk-test-secret");
  });
});

describe("OpenAI-compatible chat completions", () => {
  it("sends the key server-side, the selected model and messages", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "test-model-2026",
      choices: [{ message: { content: "Hola desde el proveedor" } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test-secret",
      model: "test-model",
      timeoutMs: 5_000,
    }, { fetchImpl });

    const result = await provider.complete(MESSAGES);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://provider.test/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer sk-test-secret" });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      model: "test-model",
      messages: MESSAGES,
      stream: false,
    });
    expect(result).toEqual({
      content: "Hola desde el proveedor",
      toolCalls: [],
      model: "test-model-2026",
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });

  it("supports non-streaming tool/function calls", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "test-model",
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: "call_1", function: { name: "lookup_page", arguments: "{\"slug\":\"home\"}" } }],
        },
      }],
    }), { status: 200 }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test",
      model: "test-model",
      timeoutMs: 5_000,
    }, { fetchImpl });

    const result = await provider.complete(MESSAGES, {
      tools: [{ type: "function", function: { name: "lookup_page", parameters: { type: "object" } } }],
      toolChoice: "auto",
    });
    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "lookup_page", arguments: "{\"slug\":\"home\"}" }]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      stream: false,
      tools: [{ type: "function", function: { name: "lookup_page" } }],
      tool_choice: "auto",
    });
  });

  it("streams text deltas from SSE", async () => {
    const fetchImpl = vi.fn(async () => new Response(sse([
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
      "data: [DONE]\n\n",
    ]), { status: 200, headers: { "content-type": "text/event-stream" } }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test",
      model: "test-model",
      timeoutMs: 5_000,
    }, { fetchImpl });

    const chunks: string[] = [];
    for await (const chunk of provider.stream(MESSAGES)) chunks.push(chunk);
    expect(chunks).toEqual(["Hola", " mundo"]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ stream: true });
  });

  it("maps 429 and 5xx responses to controlled retryable errors without leaking bodies or keys", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "rate_limit_exceeded", message: "raw provider detail that must not leak" },
    }), { status: 429 }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test-secret",
      model: "test-model",
      timeoutMs: 5_000,
    }, { fetchImpl });

    const error = await provider.complete(MESSAGES).catch((err) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "provider_rate_limited", status: 429, retryable: true, providerCode: "rate_limit_exceeded" });
    expect(JSON.stringify(error)).not.toContain("sk-test-secret");
    expect(error.message).not.toContain("raw provider detail");
  });

  it("maps invalid responses, timeouts and cancellations", async () => {
    const invalid = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1", apiKey: "sk-test", model: "test-model", timeoutMs: 5_000,
    }, { fetchImpl: async () => new Response("not-json", { status: 200 }) });
    await expect(invalid.complete(MESSAGES)).rejects.toMatchObject({ code: "provider_invalid_response" });

    const timeout = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1", apiKey: "sk-test", model: "test-model", timeoutMs: 5_000,
    }, {
      fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); },
    });
    await expect(timeout.complete(MESSAGES)).rejects.toMatchObject({ code: "provider_timeout", retryable: true });

    const controller = new AbortController();
    controller.abort();
    const aborted = createOpenAICompatibleProvider({
      baseUrl: "https://provider.test/v1", apiKey: "sk-test", model: "test-model", timeoutMs: 5_000,
    }, {
      fetchImpl: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    await expect(aborted.complete(MESSAGES, { signal: controller.signal })).rejects.toMatchObject({ code: "provider_aborted" });
  });
});
