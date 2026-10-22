/**
 * Fetch endurecido para leer contenido de pares (Fase 9b). No es una
 * optimizacion: cuando un nodo agrega contenido remoto, el fetch es parte del
 * contrato de seguridad.
 *
 * Guardas:
 *  - `redirect: "manual"` + validacion POR HOP. Un redirect por defecto permite
 *    que el host inicial pase el filtro y salte a un rango privado; aca cada
 *    Location se resuelve y se vuelve a validar antes de seguirla.
 *  - Cap por STREAMING, no post-buffer: se lee el body con un reader y se aborta
 *    al pasar el limite, en vez de descargar todo y comparar despues.
 *  - Bloqueo de rangos privados en el runtime Node: con un `lookup` inyectado
 *    (dns.lookup all) se rechaza cualquier host que resuelva a IP privada,
 *    loopback o link-local. Sin lookup, se siguen bloqueando IPs literales y
 *    `localhost`.
 *  - Timeout por AbortSignal.
 *
 * Modulo sin dependencias de Node: `fetch` y `lookup` se inyectan. Workers uses
 * platform DNS/TLS and cannot pin a connection IP; literal and redirect guards
 * still apply, but Node's DNS-pinning guarantee must not be claimed on Workers.
 */
import { isBlockedEgressIp } from "./egress-ip";
export { BLOCKED_EGRESS_CIDRS } from "./egress-ip";

export interface SafeFetchLimits {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_host"
  | "too_many_redirects"
  | "http_error"
  | "too_large"
  | "timeout"
  | "network_error";

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  text?: string;
  finalUrl?: string;
  error?: SafeFetchFailure;
}

export type PinnedFetch = (
  url: string,
  init: RequestInit,
  /** IP ya validada por `lookup`; el transporte debe conectarse a ella sin resolver otra vez. */
  address?: string,
) => Promise<Response>;

export interface SafeFetchDeps {
  fetch?: typeof fetch;
  /** Resuelve un host a sus IPs. En Node: (h) => dns.lookup(h, { all: true }).map(a => a.address). */
  lookup?: (host: string) => Promise<string[]>;
  /**
   * Transporte Node con DNS pinning: recibe la IP validada en el mismo lookup
   * y conecta a ella, manteniendo el hostname para Host/SNI. Sin esto, validar
   * y luego dejar que `fetch` vuelva a resolver permite DNS rebinding.
   */
  fetchPinned?: PinnedFetch;
}

export const SAFE_FETCH_DEFAULTS: Required<SafeFetchLimits> = {
  timeoutMs: 8000,
  maxBytes: 1_500_000,
  maxRedirects: 3,
};

/** IPv4/IPv6 en rango privado, loopback, link-local o CGNAT. */
export function isPrivateIp(rawIp: string): boolean {
  return isBlockedEgressIp(rawIp);
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Valida una URL de salida: solo https, host valido, y host no privado (por
 * literal o por resolucion, si hay `lookup`). Lanza con el reason como mensaje.
 */
async function resolveSafeAddress(url: URL, lookup?: (host: string) => Promise<string[]>): Promise<string | undefined> {
  if (url.protocol !== "https:") throw new Error("invalid_url");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("blocked_host");
  if (isIpLiteral(host) && isPrivateIp(host)) throw new Error("blocked_host");
  if (!lookup) return undefined;

  let ips: string[];
  try {
    ips = await lookup(host);
  } catch {
    throw new Error("blocked_host");
  }
  if (ips.length === 0 || ips.some(isPrivateIp)) throw new Error("blocked_host");
  // Se elige UNA direccion de esta misma resolucion. El transporte la recibe
  // como pin: no hay una segunda resolucion que un atacante pueda cambiar.
  return ips[0];
}

export async function assertSafeUrl(url: URL, lookup?: (host: string) => Promise<string[]>): Promise<void> {
  await resolveSafeAddress(url, lookup);
}

async function readCapped(res: Response, maxBytes: number): Promise<string | "too_large"> {
  const reader = (res as unknown as { body?: ReadableStream<Uint8Array> | null }).body?.getReader?.();
  if (!reader) {
    // Fallback sin streaming: se acepta el post-buffer solo cuando el runtime no
    // expone body (se documenta; el cap igual se aplica).
    const text = await res.text();
    return text.length > maxBytes ? "too_large" : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
const timedOut = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** Crea un fetcher endurecido. Inyecta `fetch` y `lookup` para poder testearlo. */
export function createSafeFetcher(deps: SafeFetchDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const fetchHop: PinnedFetch = deps.fetchPinned
    ?? ((url, init) => doFetch(url, init));
  return async function safeFetch(url: string, limits: SafeFetchLimits = {}): Promise<SafeFetchResult> {
    const { timeoutMs, maxBytes, maxRedirects } = { ...SAFE_FETCH_DEFAULTS, ...limits };
    const fail = (error: SafeFetchFailure, status?: number): SafeFetchResult => ({ ok: false, error, status });

    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return fail("invalid_url");
    }

    for (let hop = 0; hop <= maxRedirects; hop++) {
      // DNS and streamed response body share the hop's deadline. Bounding only
      // fetch headers would let a stalled lookup/body monopolize admission slots.
      const signal = AbortSignal.timeout(timeoutMs);
      let address: string | undefined;
      try {
        address = await beforeDeadline(resolveSafeAddress(current, deps.lookup), signal);
      } catch (e) {
        if (timedOut(e)) return fail("timeout");
        return fail(e instanceof Error && e.message === "invalid_url" ? "invalid_url" : "blocked_host");
      }

      let res: Response;
      try {
        res = await beforeDeadline(fetchHop(current.toString(), {
          redirect: "manual",
          headers: { accept: "application/json" },
          signal,
        }, address), signal);
      } catch (e) {
        return fail(timedOut(e) ? "timeout" : "network_error");
      }

      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location) return fail("http_error", res.status);
        if (hop === maxRedirects) return fail("too_many_redirects");
        try {
          current = new URL(location, current);
        } catch {
          return fail("invalid_url");
        }
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return fail("http_error", res.status);
      }

      try {
        const body = await beforeDeadline(readCapped(res, maxBytes), signal);
        if (body === "too_large") return fail("too_large", res.status);
        return { ok: true, status: res.status, text: body, finalUrl: current.toString() };
      } catch (e) {
        return fail(timedOut(e) ? "timeout" : "network_error", res.status);
      }
    }

    return fail("too_many_redirects");
  };
}

export type SafeFetcher = ReturnType<typeof createSafeFetcher>;
