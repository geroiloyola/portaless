// packages/apw-resolver/src/scoring/reader-identity.ts
//
// Identidad del lector (LTP v1.2, 6.3) -> ReaderState para evaluatePolicy().
//
//   anonymous         sin firma Web Bot Auth valida            -> 401
//   wba_only          firma valida, pero el origen no tiene TXT APW con `k`
//   apw_unresolvable  dice tener APW pero no se pudo comprobar: la clave que
//                     firmo no es `k` ni una clave retirada vigente, el
//                     historial no verifica, su reader_conduct no se puede
//                     cargar completa, o fallo la resolucion -> on_fail
//   apw_verified      clave = `k` del TXT del lector (o una clave retirada
//                     todavia dentro de su ventana, 6.3), historial verificado
//                     y reputacion cargada
//
// La clave que firma la request debe tener la misma huella RFC 7638 que `k`
// (6.3): asi identidad de agente e identidad APW son un solo par de claves.
//
// CLAVES NO ACTIVAS (6.3): despues de una rotacion, el lector puede seguir
// firmando con la clave retirada mientras esta este dentro de su ventana
// [validFrom, validTo] MAS una gracia de rollover (RETIRED_READER_KEY_GRACE_MS),
// para que rotar no corte en seco a los agentes que aun tenian la clave vieja
// en vuelo. Requisitos (todos fail-closed):
//   - la clave esta en la lista publicada del historial del lector, cadena ya
//     VERIFICADA contra `k` y `h` del TXT (no alcanza con agregarla al log:
//     verifyChain la validaria igual, por eso ademas se exige el punto 2);
//   - firmo al menos una entrada de esa cadena (su huella o su keyId aparece
//     como `kid` de una entrada anclada). Asi un compromiso SOLO del hosting
//     del lector no alcanza para autorizarse una clave nueva: agregar una
//     clave al arreglo `keys` del log no cambia ninguna entrada ni `h`;
//   - su ventana cubre el momento de la request (con la gracia de rollover).
// La gracia es del lado de quien VERIFICA: la rotacion cierra la clave en el
// instante de rotar (valid_to = ahora) y borra su privada; la gracia no
// extiende nada publicado, solo por cuanto tiempo se aceptan requests viejos.
//
// Cache y ventana: el resultado se cachea 5 min (READER_CACHE_OK_MS), pero
// cuando la verificacion fue por una clave retirada el TTL del exito se acota
// a `windowEndsAt - now` (nunca mas alla de `validTo + gracia`), asi que el
// limite efectivo sigue siendo la ventana de la clave, no el cache.
//
// Cache por TTL (6.9): exitos 5 min, fallos 60 s. Nunca abre: cualquier error
// termina en apw_unresolvable.
//
// ERRATA E-9: loadScores carga las reader_conduct del historial publicado del
// lector con completitud (reader-attestations.ts) y las puntua con
// scoreSubject (Anexo A). Si la carga falla, el motivo queda en `reason`.

import { jwkThumbprint } from "../did-apw/fingerprint";
import { resolveApwManifest } from "../index";
import { resolveApwHistory } from "../did-apw/history-resolver";
import type { ChainKey } from "../did-apw/history-log";
import { loadReaderConduct } from "./reader-attestations";
import { scoreSubject } from "./scoring";
import type { ReaderState } from "./policy";
import type { DimensionScore } from "./scoring";

/**
 * Gracia de rollover para claves retiradas del lector (6.3). La ventana
 * efectiva de una clave no activa es [validFrom, validTo + esta gracia].
 * Ajustar aqui (en minutos) si se quiere mas o menos margen al rotar.
 */
export const RETIRED_READER_KEY_GRACE_MS = 10 * 60 * 1000;

export interface WebBotAuthLike {
  verified: boolean;
  reason?: string;
  agentKeyId?: string | null;
  keyRecord?: { operator?: string; publicKeyJwk?: { kty?: string; crv?: string; x?: string } };
}

export type RetiredKeyVerdict = { usable: boolean; windowEndsAt?: number };

export interface RetiredKeyCheck {
  /** Claves publicadas del historial del lector (ya verificadas por verifyChain). */
  keys: ReadonlyArray<ChainKey>;
  /** `kid` de cada entrada de la cadena verificada (quien la firmo). */
  entryKids: ReadonlyArray<string | null | undefined>;
  /** Huella RFC 7638 de la clave que firmo la request. */
  thumbprint: string;
  /** `k` del TXT: la clave activa, que no pasa por esta via. */
  activeFingerprint?: string | null;
  nowMs: number;
  graceMs?: number;
}

/**
 * true si una clave NO activa del lector puede firmar una request ahora.
 * Pura y sin red: solo mira la lista de claves y los `kid` de la cadena
 * verificada. Devuelve tambien `windowEndsAt` (ms) para acotar el cache.
 */
export function isRetiredReaderKeyUsable(check: RetiredKeyCheck): RetiredKeyVerdict {
  const { thumbprint, activeFingerprint = null, nowMs } = check;
  const graceMs = check.graceMs ?? RETIRED_READER_KEY_GRACE_MS;

  // La activa es `k` del TXT: esa no es esta via.
  if (activeFingerprint && thumbprint === activeFingerprint) return { usable: false };

  const key = check.keys.find((candidate) => candidate.kid === thumbprint);
  if (!key) return { usable: false };

  // verifyChain exige que la clave con validTo = null sea `k`: una clave que
  // no es `k` con ventana abierta es un documento incoherente -> no usable.
  if (key.validTo === null) return { usable: false };
  const from = Date.parse(key.validFrom);
  const to = Date.parse(key.validTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { usable: false };

  // Debe haber firmado al menos una entrada de la cadena verificada: la
  // atadura real al historial anclado en el TXT, no solo al arreglo de claves.
  const kids = new Set(check.entryKids.filter((kid): kid is string => typeof kid === "string" && kid.length > 0));
  if (!kids.has(key.kid) && !(key.keyId && kids.has(key.keyId))) return { usable: false };

  if (nowMs < from) return { usable: false };
  const windowEndsAt = to + graceMs;
  if (nowMs > windowEndsAt) return { usable: false };
  return { usable: true, windowEndsAt };
}

export interface ReaderResolvers {
  /** `k` del TXT _apw.<host>, o null si no hay manifiesto con k. */
  resolveTxtKey(host: string): Promise<string | null>;
  /** true si el historial publicado del host verifica contra su TXT. */
  verifyHistory(host: string): Promise<boolean>;
  /**
   * Clave no activa (6.3): veredicto sobre si la huella `thumbprint` puede
   * firmar requests de `host` en `nowMs`. Opcional: sin ella, o con
   * { usable: false }, solo se acepta `k` del TXT (comportamiento previo).
   */
  acceptRetiredKey?(host: string, thumbprint: string, nowMs: number, activeFingerprint?: string | null): Promise<RetiredKeyVerdict>;
  /** Puntajes (Anexo A) del lector. Lanza Error("reader_conduct_...") si no se pueden cargar. */
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
    // Clave no activa (6.3): baja el historial UNA vez con claves y con los
    // `kid` de cada entrada, ya verificado contra `k` y `h` del TXT. En el
    // camino de rollover esto duplica la resolucion (verifyHistory vuelve a
    // bajar la cadena): el cache por host+huella la limita a una vez cada
    // 5 min por clave.
    async acceptRetiredKey(host, thumbprint, nowMs, activeFingerprint) {
      try {
        const r = await resolveApwHistory(host, fetchImpl, { includeEntries: true, includeKeys: true });
        if (!r.verified || !r.keys?.length || !r.attestations) return { usable: false };
        return isRetiredReaderKeyUsable({
          keys: r.keys,
          entryKids: r.attestations.map((entry) => entry.kid),
          thumbprint,
          activeFingerprint,
          nowMs,
        });
      } catch {
        return { usable: false };
      }
    },
    async loadScores(did) {
      const host = did.slice("did:apw:".length);
      const loaded = await loadReaderConduct(host, { fetchImpl });
      if (!loaded.ok) throw new Error(loaded.reason);
      return scoreSubject(did, loaded.attestations);
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
  let ttlMs: number;
  try {
    const k = await resolvers.resolveTxtKey(host);
    if (!k) {
      state = { kind: "wba_only", signatureAgent: operator };
      ttlMs = READER_CACHE_FAIL_MS;
    } else {
      // `k` del TXT o, si no lo es, una clave retirada todavia vigente (6.3).
      let boundToApw = k === thumb;
      let windowEndsAt: number | undefined;
      if (!boundToApw && resolvers.acceptRetiredKey) {
        const verdict = await resolvers.acceptRetiredKey(host, thumb, nowMs, k);
        // Si el veredicto llega tarde, no se abre: la ventana cerro.
        boundToApw = verdict.usable && !(typeof verdict.windowEndsAt === "number" && verdict.windowEndsAt <= nowMs);
        windowEndsAt = verdict.windowEndsAt;
      }

      if (!boundToApw) {
        state = { kind: "apw_unresolvable", did, reason: "key_not_bound_to_apw" };
        ttlMs = READER_CACHE_FAIL_MS;
      } else if (!(await resolvers.verifyHistory(host))) {
        state = { kind: "apw_unresolvable", did, reason: "history_unverified" };
        ttlMs = READER_CACHE_FAIL_MS;
      } else {
        state = { kind: "apw_verified", did, scores: await resolvers.loadScores(did) };
        // Una clave retirada no puede quedar cacheada mas alla de su ventana:
        // el TTL del exito se acota al cierre efectivo de la ventana.
        ttlMs =
          typeof windowEndsAt === "number"
            ? Math.max(0, Math.min(READER_CACHE_OK_MS, windowEndsAt - nowMs))
            : READER_CACHE_OK_MS;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    state = { kind: "apw_unresolvable", did, reason: message.startsWith("reader_conduct_") ? message : "resolution_error" };
    ttlMs = READER_CACHE_FAIL_MS;
  }

  cache.set(cacheKey, state, ttlMs, nowMs);
  return state;
}
