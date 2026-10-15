/**
 * Agregador de paginas de pares (Fase 9b). Toma N dominios de pares, pide a cada
 * uno su documento firmado y verificado, y produce un feed. El fetch y la
 * verificacion se inyectan (`loadPeer`), de modo que este modulo se prueba sin
 * abrir un solo endpoint publico ni tocar la red.
 *
 * Contrato de robustez (no es optimizacion, es la defensa):
 *  - CACHE OBLIGATORIA por par: una visita no puede disparar N fetches salientes
 *    cada vez. Hay TTL y, ante error, se sirve el valor viejo (stale-while-error)
 *    marcado como `stale: true`.
 *  - SINGLE-FLIGHT: una sola actualizacion en vuelo por par; peticiones
 *    concurrentes comparten la misma promesa.
 *  - CAP de concurrencia: nunca se abren todos los pares a la vez.
 *  - La respuesta nunca espera a un par lento mas alla del timeout del loader.
 *
 * Modulo puro (sin I/O propio): `loadPeer` y `now` se inyectan.
 */

import { capItems, MAX_AGGREGATE_ITEMS } from "./render-safe";
import type { PagesDocumentEntry } from "./pages-document";

export interface RemotePage extends PagesDocumentEntry {
  /** Dominio del par del que proviene. */
  source: string;
}

export interface PeerCacheEntry {
  value: RemotePage[];
  storedAt: number;
}

export interface PeerCache {
  get(domain: string): PeerCacheEntry | undefined;
  set(domain: string, entry: PeerCacheEntry): void;
}

/** Cache en memoria con TTL; util tambien como implementacion por defecto. */
export class InMemoryPeerCache implements PeerCache {
  private map = new Map<string, PeerCacheEntry>();
  get(domain: string): PeerCacheEntry | undefined {
    return this.map.get(domain);
  }
  set(domain: string, entry: PeerCacheEntry): void {
    this.map.set(domain, entry);
  }
}

export type PeerLoadResult = { ok: true; entries: PagesDocumentEntry[] } | { ok: false; reason: string };

export interface PeerReport {
  domain: string;
  ok: boolean;
  stale: boolean;
  count: number;
  error?: string;
  fromCache: boolean;
}

export interface AggregateResult {
  pages: RemotePage[];
  reports: PeerReport[];
}

export interface PeerAggregatorDeps {
  /** Trae y verifica el documento de un par. Nunca debe lanzar; si lo hace, se trata como error. */
  loadPeer: (domain: string) => Promise<PeerLoadResult>;
  cache?: PeerCache;
  ttlMs?: number;
  maxConcurrency?: number;
  perPeerItemCap?: number;
  totalItemCap?: number;
  now?: () => number;
}

export const AGGREGATE_DEFAULTS = {
  ttlMs: 5 * 60 * 1000,
  maxConcurrency: 4,
  perPeerItemCap: 50,
  totalItemCap: MAX_AGGREGATE_ITEMS,
};

function dedupeDomains(peers: readonly string[]): string[] {
  return [...new Set(peers.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0))];
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface PeerAggregator {
  aggregate(peers: readonly string[]): Promise<AggregateResult>;
}

/**
 * Crea un agregador con estado (cache + single-flight) que persiste entre
 * llamadas. El endpoint publico debe ser una instancia compartida, no una por
 * request: si no, ni la cache ni el single-flight sirven de nada.
 */
export function createPeerAggregator(deps: PeerAggregatorDeps): PeerAggregator {
  const cache = deps.cache ?? new InMemoryPeerCache();
  const ttlMs = deps.ttlMs ?? AGGREGATE_DEFAULTS.ttlMs;
  const maxConcurrency = deps.maxConcurrency ?? AGGREGATE_DEFAULTS.maxConcurrency;
  const perPeerItemCap = deps.perPeerItemCap ?? AGGREGATE_DEFAULTS.perPeerItemCap;
  const totalItemCap = deps.totalItemCap ?? AGGREGATE_DEFAULTS.totalItemCap;
  const now = deps.now ?? (() => Date.now());

  const inflight = new Map<string, Promise<PeerLoadResult>>();

  function loadOnce(domain: string): Promise<PeerLoadResult> {
    const existing = inflight.get(domain);
    if (existing) return existing;
    const p = (async (): Promise<PeerLoadResult> => {
      try {
        return await deps.loadPeer(domain);
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "load_failed" };
      }
    })();
    inflight.set(domain, p);
    void p.finally(() => {
      if (inflight.get(domain) === p) inflight.delete(domain);
    });
    return p;
  }

  async function aggregate(peers: readonly string[]): Promise<AggregateResult> {
    const domains = dedupeDomains(peers);
    const reports: PeerReport[] = [];
    const collected: RemotePage[][] = await mapWithConcurrency(domains, maxConcurrency, async (domain) => {
      const cached = cache.get(domain);
      const fresh = cached && now() - cached.storedAt < ttlMs;
      if (fresh) {
        reports.push({ domain, ok: true, stale: false, count: cached!.value.length, fromCache: true });
        return cached!.value;
      }

      const result = await loadOnce(domain);
      if (result.ok) {
        const pages = capItems(
          result.entries.map((e) => ({ ...e, source: domain })),
          perPeerItemCap
        );
        cache.set(domain, { value: pages, storedAt: now() });
        reports.push({ domain, ok: true, stale: false, count: pages.length, fromCache: false });
        return pages;
      }

      // stale-while-error: mejor servir lo viejo marcado que nada.
      if (cached) {
        reports.push({ domain, ok: false, stale: true, count: cached.value.length, error: result.reason, fromCache: true });
        return cached.value;
      }
      reports.push({ domain, ok: false, stale: false, count: 0, error: result.reason, fromCache: false });
      return [];
    });

    const pages = capItems(collected.flat(), totalItemCap);
    return { pages, reports };
  }

  return { aggregate };
}
