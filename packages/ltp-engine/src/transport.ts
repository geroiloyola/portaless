import { LtpFailure } from "./budget";

export interface TransportResponse {
  status: number;
  /** True only for an authenticated HTTPS channel with no protocol downgrade. */
  tlsAuthenticated: boolean;
  body: Uint8Array;
  resolverId?: string;
  channel: string;
}

export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  maxBytes: number;
  timeoutMs: number;
  stage: "A-DOH" | "A-PACKAGE";
}

export interface LtpTransport {
  readonly channel: string;
  send(request: TransportRequest): Promise<TransportResponse>;
}

const HTTPS_ONLY = /^https:$/;

function assertFetchUrl(value: string): URL {
  const url = new URL(value);
  if (!HTTPS_ONLY.test(url.protocol)) throw new LtpFailure("bootstrap_unsupported", "https_required");
  if (url.username || url.password) throw new LtpFailure("bootstrap_unsupported", "userinfo_not_allowed");
  if (url.hash) throw new LtpFailure("bootstrap_unsupported", "fragment_not_allowed");
  return url;
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new LtpFailure("response_limit_exceeded", "streamed response exceeds cap");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Real HTTPS transport for G2. It rejects redirects instead of following them,
 * enforces a per-response cap before buffering beyond it, and never falls back
 * to plaintext or to an unconfigured origin.
 */
export class FetchTransport implements LtpTransport {
  readonly channel = "consumer-https";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    const url = assertFetchUrl(request.url);
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new LtpFailure("deadline_exceeded", "no time remaining for transport");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body ? Buffer.from(request.body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      if (error instanceof LtpFailure) throw error;
      throw new LtpFailure("service_unavailable", `transport failure: ${(error as Error).name}`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new LtpFailure("bootstrap_unsupported", "redirect_not_allowed");
    }
    const finalUrl = new URL(response.url || request.url);
    if (finalUrl.origin !== url.origin || finalUrl.pathname !== url.pathname || finalUrl.search !== url.search) {
      throw new LtpFailure("bootstrap_unsupported", "redirect_not_allowed");
    }
    const body = await readBounded(response, request.maxBytes);
    return {
      status: response.status,
      tlsAuthenticated: url.protocol === "https:",
      body,
      channel: this.channel,
      resolverId: response.headers.get("x-ltp-resolver-id") ?? undefined,
    };
  }
}
