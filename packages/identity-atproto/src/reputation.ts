// packages/identity-atproto/src/reputation.ts
//
// Join de reputacion para un handle AT Protocol -- el lado "simbiotico"
// del puente APW <-> AT (vision del whitepaper: @username.wikipedia.org
// debe poder mostrar la reputacion del SITIO (wikipedia.org, dimensiones
// W) y la del USUARIO (dimensiones R), sin que ninguno de los dos lados
// obligue al otro a existir):
//
//   1. Resuelve el handle AT (spec oficial, verificacion bidireccional).
//   2. Busca la identidad APW mas proxima por sufijo de dominio
//      (username.wikipedia.org -> wikipedia.org -> ...) con confianza
//      self / subdomain / also_known_as (link.ts). Si la encuentra:
//   3. Reputacion del SITIO: la fuente local si el sitio soy esta
//      misma instancia (identity did:apw:<siteId>), si endpoint publico
//      GET https://<siteId>/trust/<siteId> del sitio remoto (proyeccion
//      solo-publica, mismas funciones scoreSiteDimensions +
//      projectTrustView que usa /trust/:siteId).
//   4. Reputacion del USUARIO: atestaciones reader_conduct cuyo subject
//      sea did:apw:<handle> (el lector con host propio). Sin historial =>
//      status "no_data" honesto, no un cero inventado.
//
// Todo es opcional y degradable: sin APW igual responde identity AT; sin
// trust remoto igual responde el vinculo con trust: null + limitation.
// Sin red real en tests: cada dependencia se inyecta (deps.resolveAtproto,
// deps.resolveApwSite, deps.fetchSiteTrust, deps.loadConduct).

import { resolvableHandle } from "./handle";
import { candidateDomainsForHandle, findApwLink, type ApwLinkConfidence } from "./link";
import {
  resolveAtprotoIdentity,
  type IdentityReason,
  type ResolveDeps,
  type ResolveIdentityResult,
} from "./resolve";

import { resolveApwIdentity, type ApwIdentityResult } from "../../apw-resolver/src/index";
import { loadReaderConduct, type ReaderConductResult } from "../../apw-resolver/src/scoring/reader-attestations";
import { scoreSubject, type DimensionScore } from "../../apw-resolver/src/scoring/scoring";
import { scoreSiteDimensions, type SiteSnapshotLike } from "../../apw-resolver/src/scoring/site-dimensions";
import { projectTrustView } from "../../apw-resolver/src/scoring/policy";

export interface AtprotoReputationEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export interface SiteTrustView {
  siteId: string;
  counts: Record<string, number>;
  /** Proyeccion SOLO publica (governed: "withheld") o la del sitio si viene ya acotada. */
  projection: ReturnType<typeof projectTrustView> | null;
  /** Ruta publica para el snapshot completo. */
  trustUrl: string;
}

export type AtprotoUserReputation = {
  status: "ok";
  subjectDid: string;
  dimensions: DimensionScore[];
} | {
  status: "no_data";
  reason: string;
};

export interface AtprotoReputationResult {
  handle: string;
  resolved: boolean;
  reason?: IdentityReason;
  identity?: {
    did: string;
    didMethod: "plc" | "web";
    resolvedBy: "txt" | "https";
    claimedHandles: string[];
    hasSigningKey: boolean;
    pds: string | null;
  };
  apw: null | {
    siteId: string;
    confidence: ApwLinkConfidence;
    did: string;
    trust: SiteTrustView | null;
  };
  user: AtprotoUserReputation | null;
  resolvedAt: string;
  limitations: string[];
}

export interface AtprotoReputationDeps {
  env?: AtprotoReputationEnv;
  fetchImpl?: typeof fetch;
  /** Resolucion AT completa (inyectable para tests). */
  resolveAtproto?: (handle: string, deps: ResolveDeps) => Promise<ResolveIdentityResult>;
  /** Resolucion APW de un dominio candidato (inyectable). */
  resolveApwSite?: (domain: string, fetchImpl: typeof fetch) => Promise<ApwIdentityResult>;
  /** Snapshot de confianza del sitio (inyectable; por defecto local-vs-remoto). */
  fetchSiteTrust?: (siteId: string) => Promise<SiteTrustView | null>;
  /** Atestaciones reader_conduct del lector (inyectable). */
  loadConduct?: (host: string) => Promise<ReaderConductResult>;
}

/** Limitaciones estructurales siempre presentes (honestidad del proyecto). */
const STATIC_LIMITATIONS = [
  "atproto_third_party_resolution: la resolucion depende de terceros (DNS y plc.directory)",
  "apw_link_suffix_walk: solo se descubren vinculos por sufijo de dominio; el indice inverso de claims es Portaless Index (futuro)",
  "reader_conduct_host_scoped: la reputacion R vive en el host del lector; usuarios AT sin historial APW reportan no_data",
  "remote_trust_best_effort: la reputacion W remota depende del endpoint publico /trust del sitio",
] as const;

const CACHE_OK_MS = 5 * 60 * 1000;
const CACHE_FAIL_MS = 60 * 1000;
const cache = new Map<string, { result: AtprotoReputationResult; expiresAt: number }>();

function dimensionList(scores: Map<string, DimensionScore>): DimensionScore[] {
  // scoreSubject keeps protocol priors for calculations (notably an
  // uncalibrated R-05 = 4.0, count/weight 0). A public projection must not
  // render those priors as observed evidence.
  return [...scores.values()]
    .filter((score) => score.count > 0 && score.weightSum > 0)
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

function countsFromSnapshot(snapshot: SiteSnapshotLike): Record<string, number> {
  return {
    self: snapshot.self?.length ?? 0,
    agent: snapshot.agent?.length ?? 0,
    community: snapshot.community?.length ?? 0,
    escrowReports: snapshot.escrowReports?.length ?? 0,
  };
}

/**
 * Trust del sitio: local si esta misma instancia ES el sitio (la
 * identidad local es did:apw:<siteId>), si no el endpoint publico
 * GET https://<siteId>/trust/<siteId> del sitio remoto. Ambos caminos
 * devuelven SOLO el nivel publico (aggregates + PUBLIC_DIMENSIONS).
 */
function defaultFetchSiteTrust(env: AtprotoReputationEnv | undefined, fetchImpl: typeof fetch) {
  return async (siteId: string): Promise<SiteTrustView | null> => {
    const trustUrl = `https://${siteId}/trust/${siteId}`;
    // Local solo si este deployment es el sitio: identidad did:apw:<siteId>.
    if (env && (env.DB || env.PORTALESS_SQLITE_PATH)) {
      try {
        const { createSiteIdentityStore } = await import("../../apw-resolver/src/did-apw/store-factory");
        const identity = await createSiteIdentityStore(env as Record<string, unknown>);
        const record = await identity.get("default");
        if (record?.did === `did:apw:${siteId}`) {
          const { createSiteTrustScoreStore } = await import("../../trust-layer/src/site-trust/store-factory");
          const store = await createSiteTrustScoreStore(env as Record<string, unknown>);
          const snapshot = await store.getSnapshot(siteId);
          return {
            siteId,
            counts: countsFromSnapshot(snapshot),
            projection: projectTrustView(scoreSiteDimensions(snapshot), false),
            trustUrl,
          };
        }
      } catch {
        return null;
      }
    }

    let response: Response;
    try {
      response = await fetchImpl(trustUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return null;
    }

    let body: any;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    // 200 con el snapshot completo -> recalculamos la proyeccion publica aca.
    if (response.ok && Array.isArray(body?.self)) {
      const snapshot = body as SiteSnapshotLike;
      return {
        siteId,
        counts: countsFromSnapshot(snapshot),
        projection: projectTrustView(scoreSiteDimensions(snapshot), false),
        trustUrl,
      };
    }

    // Politica activa (401/403/402): la respuesta trae `public` con lo
    // siempre-visible (counts + projection publica) -- no intentamos mas.
    if (body?.public?.projection) {
      return { siteId, counts: body.public.counts ?? {}, projection: body.public.projection, trustUrl };
    }

    return null;
  };
}

async function resolveApwCandidates(
  handle: string,
  deps: AtprotoReputationDeps
): Promise<Array<{ siteId: string; didDocument: unknown }>> {
  const resolveApwSite = deps.resolveApwSite ?? ((domain: string, fetchImpl: typeof fetch) => resolveApwIdentity(domain, fetchImpl));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const domains = candidateDomainsForHandle(handle);
  const results = await Promise.all(
    domains.map(async (domain) => {
      try {
        const resolution = await resolveApwSite(domain, fetchImpl);
        if (!resolution.verified || !resolution.did) return null;
        return { siteId: domain, didDocument: resolution.didDocument ?? null, did: resolution.did };
      } catch {
        return null;
      }
    })
  );
  return results.filter((entry): entry is { siteId: string; didDocument: unknown; did: string } => entry !== null);
}

/**
 * Construye el join completo para un handle. Nunca lanza: los fallos
 * vuelven en el resultado estructurado (mismo principio que
 * resolveApwIdentity). Cachea OK 5 min / fallos 1 min por handle.
 */
export async function buildAtprotoReputation(rawHandle: unknown, deps: AtprotoReputationDeps = {}): Promise<AtprotoReputationResult> {
  const parsed = resolvableHandle(rawHandle);
  if (!parsed.ok) {
    return {
      handle: typeof rawHandle === "string" ? rawHandle.trim().toLowerCase() : String(rawHandle ?? ""),
      resolved: false,
      reason: parsed.reason === "reserved_tld" ? "reserved_tld" : "invalid_handle",
      apw: null,
      user: null,
      resolvedAt: new Date().toISOString(),
      limitations: [...STATIC_LIMITATIONS],
    };
  }
  const handle = parsed.handle;

  const cached = cache.get(handle);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveAtproto = deps.resolveAtproto ?? ((h: string, d: ResolveDeps) => resolveAtprotoIdentity(h, d));

  const resolution = await resolveAtproto(handle, { fetchImpl });
  if (!resolution.ok) {
    const failed: AtprotoReputationResult = {
      handle,
      resolved: false,
      reason: resolution.reason,
      apw: null,
      user: null,
      resolvedAt: new Date().toISOString(),
      limitations: [...STATIC_LIMITATIONS],
    };
    cache.set(handle, { result: failed, expiresAt: Date.now() + CACHE_FAIL_MS });
    return failed;
  }

  const identity = resolution.identity;

  // --- Vinculo APW + reputacion del sitio ---
  const candidates = await resolveApwCandidates(handle, deps);
  const link = findApwLink(
    handle,
    candidates.map((candidate) => ({ siteId: candidate.siteId, didDocument: candidate.didDocument as never }))
  );

  let apw: AtprotoReputationResult["apw"] = null;
  const limitations: string[] = [...STATIC_LIMITATIONS];
  if (link) {
    const candidate = candidates.find((entry) => entry.siteId === link.siteId)!;
    const fetchSiteTrust = deps.fetchSiteTrust ?? defaultFetchSiteTrust(deps.env, fetchImpl);
    let trust: SiteTrustView | null = null;
    try {
      trust = await fetchSiteTrust(link.siteId);
    } catch {
      trust = null;
    }
    if (!trust) limitations.push("site_trust_unreachable: no se pudo leer la reputacion W del sitio");
    apw = { siteId: link.siteId, confidence: link.confidence, did: candidate.did, trust };
  }

  // --- Reputacion del usuario (reader_conduct del lector con ese host) ---
  let user: AtprotoReputationResult["user"] = null;
  const loadConduct = deps.loadConduct ?? ((host: string) => loadReaderConduct(host, { fetchImpl }));
  try {
    const conduct = await loadConduct(handle);
    if (conduct.ok) {
      const dimensions = dimensionList(scoreSubject(`did:apw:${handle}`, conduct.attestations));
      user = {
        ...(dimensions.length === 0
          ? { status: "no_data" as const, reason: "no_scored_dimensions" }
          : { status: "ok" as const, subjectDid: `did:apw:${handle}`, dimensions }),
      };
    } else {
      user = { status: "no_data", reason: conduct.reason };
    }
  } catch {
    user = { status: "no_data", reason: "reader_conduct_unreachable" };
  }

  const result: AtprotoReputationResult = {
    handle,
    resolved: true,
    identity: {
      did: identity.did,
      didMethod: identity.didMethod,
      resolvedBy: identity.resolvedBy,
      claimedHandles: identity.claimedHandles,
      hasSigningKey: identity.signingKey !== null,
      pds: identity.pds,
    },
    apw,
    user,
    resolvedAt: new Date().toISOString(),
    limitations,
  };

  cache.set(handle, { result, expiresAt: Date.now() + CACHE_OK_MS });
  return result;
}

/** Solo para tests: limpia el cache por handle. */
export function __clearAtprotoReputationCacheForTests(): void {
  cache.clear();
}
