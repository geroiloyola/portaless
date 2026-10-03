// packages/apw-resolver/src/scoring/reader-identity.ts
//
// Identidad del lector (LTP v1.2, 6.3) -> ReaderState para evaluatePolicy().
//
//   anonymous         sin firma Web Bot Auth valida            -> 401
//   wba_only          firma valida, pero el origen no tiene TXT APW con `k`
//   apw_unresolvable  dice tener APW pero no se pudo comprobar: la clave que
//                     firmo no es `k`, el historial no verifica o fallo la
//                     resolucion                                 -> on_fail
//   apw_verified      clave = `k` del TXT del lector e historial verificado
//
// La clave que firma la request debe tener la misma huella RFC 7638 que `k`
// (6.3): asi identidad de agente e identidad APW son un solo par de claves.
// En el MVP solo se acepta `k` (la clave activa); claves listadas en did.json
// pero no activas quedan para un cambio posterior.
//
// Cache por TTL (6.9): exitos 5 min, fallos 60 s, para no resolver DNS y
// historial en cada request ni permitir un DoS por resolucion. Nunca abre:
// cualquier error termina en apw_unresolvable.
//
// loadScores: en este cambio el cargador por defecto devuelve un mapa vacio
// (todo neutral 4.0), asi que una politica con umbrales rechaza a todos los
// lectores. La carga de reader_conduct desde el historial del lector va en
// el siguiente commit. Sin politica activa la lectura sigue siendo publica.

import { jwkThumbprint } from "../did-apw/fingerprint";
import { resolveApwManifest } from "../index";
import { resolveApwHistory } from "../did-apw/history-resolver";
import type { ReaderState } from "./policy";
import type { DimensionScore } from "./scoring";

export interface WebBotAuthLike {
  verified: boolean;
  reason?: string;
  agentKeyId?: string | null;
  keyRecord?: { operator?: string; publicKeyJwk?: { kty?: string; crv?: string; x?: string } };
}

export interface ReaderResolvers {
  /** `k` del TXT _apw.<host>, o null si no hay manifiesto con k. */
  resolveTxtKey(host: string): Promise<string | null>;
  /** true si el historial publicado del host verifica contra su TXT. */
  verifyHistory(host: string): Promise<boolean>;
  /** Puntajes (Anexo A) del lector. */
  loadScores(did: string): Promise<ReadonlyMap<string, DimensionScore>>;
}

export const READER_CACHE_OK_MS = 5 * 60 * 1000;
export const READER_CACHE_FAIL_MS = 60 * 1000;

interface CacheEntry {
  state: ReaderState;
  expiresAt: number;
}

export class ReaderStateCache {
  private entries = new Map<string, CacheEntry>();
  constructor(private readonly maxEntries = 1000) {}

  get(key: string, nowMs: number): ReaderState | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expiresAt <= nowMs) {
      this.entries.delete(key);
      return null;
    }
    return e.state;
  }

  set(key: string, state: ReaderState, ttlMs: number, nowMs: number): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { state, expiresAt: nowMs + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

const defaultCache = new ReaderStateCache();

/** Solo para tests. */
export function __resetReaderCacheForTests(): void {
  defaultCache.clear();
}

/** Origen https de Signature-Agent -> host en minusculas, o null. */
export function readerHostFromOperator(operator: unknown): string | null {
  if (typeof operator !== "string" || !operator) return null;
  try {
    const url = new URL(operator);
    if (url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/[.]$/, "") || null;
  } catch {
    return null;
  }
}

export function defaultReaderResolvers(fetchImpl: typeof fetch = fetch): ReaderResolvers {
  return {
    async resolveTxtKey(host) {
      const r = await resolveApwManifest(host, fetchImpl);
      return r.resolved && r.manifest?.k ? r.manifest.k : null;
    },
    async verifyHistory(host) {
      const r = await resolveApwHistory(host, fetchImpl);
      return r.verified === true;
    },
    async loadScores() {
      return new Map<string, DimensionScore>();
    },
  };
}

export async function resolveReaderState(
  wba: WebBotAuthLike | null | undefined,
  resolvers: ReaderResolvers,
  cache: ReaderStateCache = defaultCache,
  nowMs: number = Date.now()
): Promise<ReaderState> {
  if (!wba || !wba.verified) return { kind: "anonymous" };

  const operator = wba.keyRecord?.operator ?? "";
  const host = readerHostFromOperator(operator);
  const jwk = wba.keyRecord?.publicKeyJwk;
  if (!host || !jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    return { kind: "wba_only", signatureAgent: operator };
  }

  let thumb: string;
  try {
    thumb = await jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: jwk.x } as JsonWebKey);
  } catch {
    return { kind: "wba_only", signatureAgent: operator };
  }

  const cacheKey = `${host}|${thumb}`;
  const cached = cache.get(cacheKey, nowMs);
  if (cached) return cached;

  const did = `did:apw:${host}`;
  let state: ReaderState;
  try {
    const k = await resolvers.resolveTxtKey(host);
    if (!k) {
      state = { kind: "wba_only", signatureAgent: operator };
    } else if (k !== thumb) {
      state = { kind: "apw_unresolvable", did, reason: "key_not_bound_to_apw" };
    } else if (!(await resolvers.verifyHistory(host))) {
      state = { kind: "apw_unresolvable", did, reason: "history_unverified" };
    } else {
      state = { kind: "apw_verified", did, scores: await resolvers.loadScores(did) };
    }
  } catch {
    state = { kind: "apw_unresolvable", did, reason: "resolution_error" };
  }

  cache.set(cacheKey, state, state.kind === "apw_verified" ? READER_CACHE_OK_MS : READER_CACHE_FAIL_MS, nowMs);
  return state;
}
