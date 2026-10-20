// Explicit OpenAI-compatible provider profile.
//
// Scope is deliberately narrow and testable:
//   - bearer API key supplied through the server environment only;
//   - configurable HTTPS base URL and model;
//   - /chat/completions request/response shape;
//   - server-side streaming over SSE (text deltas);
//   - non-streaming tool/function calling definitions and tool_calls output;
//   - bounded timeouts, caller cancellation and sanitized errors.
//
// "100% compatible with every provider" is not claimed. A provider is
// supported only after this contract suite runs against that real endpoint.

export const OPENAI_COMPAT_PROVIDER = "openai-compatible" as const;
export const OPENAI_COMPAT_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_COMPAT_DEFAULT_TIMEOUT_MS = 30_000;
export const OPENAI_COMPAT_MAX_TIMEOUT_MS = 120_000;

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface OpenAICompatibleCapabilities {
  chatCompletions: true;
  streaming: true;
  toolCalls: true;
  streamingToolCalls: false;
}

export interface OpenAICompatibleProfile {
  provider: typeof OPENAI_COMPAT_PROVIDER;
  baseUrl: string;
  model: string;
  apiKey: "server-side";
  capabilities: OpenAICompatibleCapabilities;
}

export interface OpenAICompatibleEnv {
  PORTALESS_OPENAI_API_KEY?: string;
  PORTALESS_OPENAI_BASE_URL?: string;
  PORTALESS_OPENAI_MODEL?: string;
  PORTALESS_OPENAI_TIMEOUT_MS?: string;
  [key: string]: string | undefined;
}

export type OpenAICompatibleLoadResult =
  | { enabled: false; config: null; profile: null; errors: string[] }
  | { enabled: true; config: OpenAICompatibleConfig; profile: OpenAICompatibleProfile; errors: [] };

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

export interface ChatRequestOptions {
  tools?: OpenAIToolDefinition[];
  toolChoice?: OpenAIToolChoice;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface OpenAIToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: OpenAIToolCall[];
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
}

export type ProviderErrorCode =
  | "provider_http_error"
  | "provider_rate_limited"
  | "provider_invalid_response"
  | "provider_timeout"
  | "provider_aborted"
  | "provider_network_error"
  | "provider_stream_error";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly options: { status?: number; retryable?: boolean; providerCode?: string } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get retryable(): boolean {
    return this.options.retryable === true;
  }

  get providerCode(): string | undefined {
    return this.options.providerCode;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function normalizeProviderBaseUrl(raw: unknown): string | null {
  const value = clean(raw) || OPENAI_COMPAT_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) return null;
  return url.toString().replace(/\/+$/, "");
}

export function loadOpenAICompatibleConfig(env: OpenAICompatibleEnv): OpenAICompatibleLoadResult {
  const apiKey = clean(env.PORTALESS_OPENAI_API_KEY);
  const model = clean(env.PORTALESS_OPENAI_MODEL);
  const baseUrlRaw = clean(env.PORTALESS_OPENAI_BASE_URL);
  const timeoutRaw = clean(env.PORTALESS_OPENAI_TIMEOUT_MS);

  if (!apiKey && !model && !baseUrlRaw) {
    return { enabled: false, config: null, profile: null, errors: [] };
  }

  const errors: string[] = [];
  if (!apiKey) errors.push("PORTALESS_OPENAI_API_KEY is required");
  if (!model) errors.push("PORTALESS_OPENAI_MODEL is required");
  const baseUrl = normalizeProviderBaseUrl(baseUrlRaw);
  if (!baseUrl) errors.push("PORTALESS_OPENAI_BASE_URL must be an https URL (or loopback http) without credentials/query/hash");

  let timeoutMs = OPENAI_COMPAT_DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const parsed = Number(timeoutRaw);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > OPENAI_COMPAT_MAX_TIMEOUT_MS) {
      errors.push(`PORTALESS_OPENAI_TIMEOUT_MS must be an integer between 1000 and ${OPENAI_COMPAT_MAX_TIMEOUT_MS}`);
    } else {
      timeoutMs = parsed;
    }
  }
  if (errors.length || !baseUrl) return { enabled: false, config: null, profile: null, errors };

  const config: OpenAICompatibleConfig = { baseUrl, apiKey, model, timeoutMs };
  return {
    enabled: true,
    config,
    profile: {
      provider: OPENAI_COMPAT_PROVIDER,
      baseUrl,
      model,
      apiKey: "server-side",
      capabilities: {
        chatCompletions: true,
        streaming: true,
        toolCalls: true,
        streamingToolCalls: false,
      },
    },
    errors: [],
  };
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleDeps {
  fetchImpl?: FetchLike;
}

export interface OpenAICompatibleProvider {
  readonly profile: OpenAICompatibleProfile;
  complete(messages: readonly ChatMessage[], options?: ChatRequestOptions): Promise<ChatCompletionResult>;
  stream(messages: readonly ChatMessage[], options?: ChatRequestOptions): AsyncGenerator<string, void, void>;
}

function requestSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function safeProviderCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const record = error as { code?: unknown; type?: unknown };
  const candidate = typeof record.code === "string" ? record.code : typeof record.type === "string" ? record.type : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : undefined;
}

async function httpError(response: Response): Promise<ProviderError> {
  let providerCode: string | undefined;
  try {
    providerCode = safeProviderCode(await response.json());
  } catch {
    providerCode = undefined;
  }
  if (response.status === 429) {
    return new ProviderError("provider_rate_limited", "The provider rate-limited the request.", {
      status: 429, retryable: true, providerCode,
    });
  }
  return new ProviderError("provider_http_error", `The provider returned HTTP ${response.status}.`, {
    status: response.status,
    retryable: response.status >= 500,
    providerCode,
  });
}

function networkError(err: unknown, external?: AbortSignal): ProviderError {
  if (external?.aborted) {
    return new ProviderError("provider_aborted", "The request was cancelled.");
  }
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return new ProviderError("provider_timeout", "The provider request timed out.", { retryable: true });
  }
  return new ProviderError("provider_network_error", "The provider request failed before a controlled response.", {
    retryable: true,
  });
}

function requestBody(config: OpenAICompatibleConfig, messages: readonly ChatMessage[], options: ChatRequestOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };
  if (options.tools?.length) body.tools = options.tools;
  if (options.toolChoice !== undefined) body.tool_choice = options.toolChoice;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  return body;
}

function parseToolCalls(raw: unknown): OpenAIToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: OpenAIToolCall[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; function?: unknown };
    const fn = record.function;
    if (!fn || typeof fn !== "object") continue;
    const name = (fn as { name?: unknown }).name;
    const args = (fn as { arguments?: unknown }).arguments;
    if (typeof record.id !== "string" || typeof name !== "string" || typeof args !== "string") continue;
    calls.push({ id: record.id, name, arguments: args });
  }
  return calls;
}

function usageFrom(raw: unknown): ChatCompletionResult["usage"] {
  if (!raw || typeof raw !== "object") return { promptTokens: null, completionTokens: null, totalTokens: null };
  const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { promptTokens: num(u.prompt_tokens), completionTokens: num(u.completion_tokens), totalTokens: num(u.total_tokens) };
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  deps: OpenAICompatibleDeps = {},
): OpenAICompatibleProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const profile: OpenAICompatibleProfile = {
    provider: OPENAI_COMPAT_PROVIDER,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: "server-side",
    capabilities: { chatCompletions: true, streaming: true, toolCalls: true, streamingToolCalls: false },
  };

  async function post(messages: readonly ChatMessage[], options: ChatRequestOptions, stream: boolean): Promise<Response> {
    const signal = requestSignal(config.timeoutMs, options.signal);
    try {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          accept: stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(requestBody(config, messages, options, stream)),
        signal,
      });
      if (!response.ok) throw await httpError(response);
      return response;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw networkError(err, options.signal);
    }
  }

  return {
    profile,
    async complete(messages, options = {}) {
      const response = await post(messages, options, false);
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ProviderError("provider_invalid_response", "The provider response was not valid JSON.");
      }
      if (!data || typeof data !== "object") {
        throw new ProviderError("provider_invalid_response", "The provider response was empty.");
      }
      const record = data as {
        choices?: unknown;
        model?: unknown;
        usage?: unknown;
      };
      const choice = Array.isArray(record.choices) ? record.choices[0] : null;
      const message = choice && typeof choice === "object" ? (choice as { message?: unknown }).message : null;
      if (!message || typeof message !== "object") {
        throw new ProviderError("provider_invalid_response", "The provider response has no message.");
      }
      const messageRecord = message as { content?: unknown; tool_calls?: unknown };
      const content = typeof messageRecord.content === "string" ? messageRecord.content : null;
      const toolCalls = parseToolCalls(messageRecord.tool_calls);
      if (content === null && toolCalls.length === 0) {
        throw new ProviderError("provider_invalid_response", "The provider response has neither content nor tool calls.");
      }
      return {
        content,
        toolCalls,
        model: typeof record.model === "string" ? record.model : config.model,
        usage: usageFrom(record.usage),
      };
    },
    async *stream(messages, options = {}) {
      const response = await post(messages, options, true);
      if (!response.body) {
        throw new ProviderError("provider_invalid_response", "The provider returned no stream body.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const newline = buffer.indexOf("\n");
            if (newline < 0) break;
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") return;
            let event: unknown;
            try {
              event = JSON.parse(payload);
            } catch {
              throw new ProviderError("provider_stream_error", "The provider stream contained invalid JSON.");
            }
            if (event && typeof event === "object" && "error" in event) {
              throw new ProviderError("provider_stream_error", "The provider stream reported an error.", {
                providerCode: safeProviderCode(event),
              });
            }
            const choices = event && typeof event === "object" ? (event as { choices?: unknown }).choices : null;
            const delta = Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
              ? (choices[0] as { delta?: unknown }).delta
              : null;
            const content = delta && typeof delta === "object" ? (delta as { content?: unknown }).content : null;
            if (typeof content === "string" && content.length > 0) yield content;
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw networkError(err, options.signal);
      } finally {
        reader.releaseLock();
      }
    },
  };
}
