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
 * Modulo sin dependencias de Node: `fetch` y `lookup` se inyectan. En workerd el
 * runtime ya bloquea fetch a IP directa y TCP a localhost; la superficie real es
 * el self-host Node, que es donde se pasa `lookup`.
 */

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

export interface SafeFetchDeps {
  fetch?: typeof fetch;
  /** Resuelve un host a sus IPs. En Node: (h) => dns.lookup(h, { all: true }).map(a => a.address). */
  lookup?: (host: string) => Promise<string[]>;
}

export const SAFE_FETCH_DEFAULTS: Required<SafeFetchLimits> = {
  timeoutMs: 8000,
  maxBytes: 1_500_000,
  maxRedirects: 3,
};

/** IPv4/IPv6 en rango privado, loopback, link-local o CGNAT. */
export function isPrivateIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true; // link-local, unique-local fc00::/7
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Valida una URL de salida: solo https, host valido, y host no privado (por
 * literal o por resolucion, si hay `lookup`). Lanza con el reason como mensaje.
 */
export async function assertSafeUrl(url: URL, lookup?: (host: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== "https:") throw new Error("invalid_url");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("blocked_host");
  if (isIpLiteral(host) && isPrivateIp(host)) throw new Error("blocked_host");
  if (lookup) {
    let ips: string[];
    try {
      ips = await lookup(host);
    } catch {
      throw new Error("blocked_host");
    }
    if (ips.length === 0 || ips.some(isPrivateIp)) throw new Error("blocked_host");
  }
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

/** Crea un fetcher endurecido. Inyecta `fetch` y `lookup` para poder testearlo. */
export function createSafeFetcher(deps: SafeFetchDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
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
      try {
        await assertSafeUrl(current, deps.lookup);
      } catch (e) {
        return fail(e instanceof Error && e.message === "invalid_url" ? "invalid_url" : "blocked_host");
      }

      let res: Response;
      try {
        res = await doFetch(current.toString(), {
          redirect: "manual",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        return fail(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error");
      }

      if (res.status >= 300 && res.status < 400) {
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

      if (!res.ok) return fail("http_error", res.status);

      const body = await readCapped(res, maxBytes);
      if (body === "too_large") return fail("too_large", res.status);
      return { ok: true, status: res.status, text: body, finalUrl: current.toString() };
    }

    return fail("too_many_redirects");
  };
}

export type SafeFetcher = ReturnType<typeof createSafeFetcher>;
