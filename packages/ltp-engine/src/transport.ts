import { isIP } from "node:net";
import { request as httpsRequest, type IncomingMessage } from "node:https";
import { LtpFailure } from "./budget";
import { assertSafeEndpointUrl, resolvePinnedAddress, type ResolvedAddress, type ResolveHook } from "./ssrf";

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

export interface OpenRequest {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Uint8Array;
  maxBytes: number;
  timeoutMs: number;
  pinned: ResolvedAddress;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}

export type OpenHook = (request: OpenRequest) => Promise<RawResponse>;

export interface FetchTransportHooks {
  resolve?: ResolveHook;
  open?: OpenHook;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LtpFailure("deadline_exceeded", "transport deadline exceeded")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function defaultOpen(request: OpenRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const hostname = request.url.hostname.replace(/^\[|\]$/g, "");
    const literal = isIP(hostname) !== 0;
    const req = httpsRequest({
      protocol: "https:",
      hostname,
      port: request.url.port || 443,
      path: `${request.url.pathname}${request.url.search}`,
      method: request.method,
      headers: request.headers,
      agent: false,
      autoSelectFamily: false,
      rejectUnauthorized: true,
      servername: literal ? undefined : hostname,
      lookup: (_host, options, callback) => {
        const all = (options as { all?: boolean } | undefined)?.all;
        if (all) callback(null, [{ address: request.pinned.address, family: request.pinned.family }]);
        else callback(null, request.pinned.address, request.pinned.family);
      },
    }, (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new LtpFailure("bootstrap_unsupported", "redirect_not_allowed"));
        return;
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > request.maxBytes) {
        response.resume();
        reject(new LtpFailure("response_limit_exceeded", "content-length exceeds cap"));
        return;
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > request.maxBytes) {
          req.destroy();
          reject(new LtpFailure("response_limit_exceeded", "streamed response exceeds cap"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({ status, headers: response.headers, body });
      });
      response.on("error", () => reject(new LtpFailure("service_unavailable", "transport response failure")));
      response.on("aborted", () => reject(new LtpFailure("service_unavailable", "transport response aborted")));
    });
    req.on("error", (error: Error & { code?: string }) => {
      if (error instanceof LtpFailure) reject(error);
      else if (error.code === "ETIMEDOUT" || error.code === "ECONNRESET") reject(new LtpFailure("deadline_exceeded", "transport timeout"));
      else reject(new LtpFailure("service_unavailable", `transport failure: ${error.code ?? error.name}`));
    });
    req.setTimeout(request.timeoutMs, () => {
      req.destroy(new LtpFailure("deadline_exceeded", "transport timeout"));
    });
    if (request.body) req.write(Buffer.from(request.body));
    req.end();
  });
}

/**
 * Real HTTPS transport for G2. It validates the destination, resolves all DNS
 * answers once, rejects any blocked range, and pins the verified address in the
 * socket lookup so a second answer cannot redirect the connection. It never
 * follows redirects, never downgrades to HTTP, and enforces a hard byte cap.
 */
export class FetchTransport implements LtpTransport {
  readonly channel = "consumer-https";
  private readonly resolve?: ResolveHook;
  private readonly open: OpenHook;

  constructor(hooks: FetchTransportHooks = {}) {
    this.resolve = hooks.resolve;
    this.open = hooks.open ?? defaultOpen;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new LtpFailure("deadline_exceeded", "no time remaining for transport");
    }
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new LtpFailure("response_limit_exceeded", "invalid response cap");
    }
    const url = assertSafeEndpointUrl(request.url);
    const pinned = await withDeadline(resolvePinnedAddress(url.hostname, this.resolve), request.timeoutMs);
    const raw = await withDeadline(this.open({
      url, method: request.method, headers: request.headers, body: request.body,
      maxBytes: request.maxBytes, timeoutMs: request.timeoutMs, pinned,
    }), request.timeoutMs);
    if (raw.status >= 300 && raw.status < 400) {
      throw new LtpFailure("bootstrap_unsupported", "redirect_not_allowed");
    }
    if (raw.body.byteLength > request.maxBytes) {
      throw new LtpFailure("response_limit_exceeded", "response exceeds cap");
    }
    if (raw.headers && typeof raw.headers === "object") {
      const declared = Number(headerValue(raw.headers, "content-length"));
      if (Number.isFinite(declared) && declared > request.maxBytes) {
        throw new LtpFailure("response_limit_exceeded", "content-length exceeds cap");
      }
    }
    return {
      status: raw.status,
      tlsAuthenticated: url.protocol === "https:",
      body: raw.body,
      resolverId: headerValue(raw.headers, "x-ltp-resolver-id"),
      channel: this.channel,
    };
  }
}
