// packages/cloud-images/src/trust.ts
//
// Captura de la SiteTrustScore PUBLICA contemporanea que va dentro del
// payload firmado: los mismos inputs que usa GET /trust/:siteId
// (scoreSiteDimensions + projectTrustView en modo solo-publico, igual
// que el join de reputacion AT). Nunca lanza: si el store no se puede
// leer, el payload se firma igual con trust: null (la firma no depende
// de la reputacion; la reputacion es dato adicional y honesto).

import { scoreSiteDimensions } from "../../apw-resolver/src/scoring/site-dimensions";
import { projectTrustView } from "../../apw-resolver/src/scoring/policy";
import type { ImageTrust } from "./payload";

/** El sitio propio usa siteId "default" (misma convencion que
 *  site_identity y /admin/site-trust/:siteId/self). */
export const IMAGE_SITE_ID = "default";

export interface SiteTrustSnapshotLike {
  siteId: string;
  self?: ReadonlyArray<unknown>;
  agent?: ReadonlyArray<unknown>;
  community?: ReadonlyArray<unknown>;
  escrowReports?: ReadonlyArray<unknown>;
}

export interface TrustStoreLike {
  getSnapshot(siteId: string): Promise<SiteTrustSnapshotLike>;
}

export interface CaptureTrustDeps {
  createTrustStore?: (env: Record<string, unknown>) => Promise<TrustStoreLike>;
  now?: () => Date;
}

function countsFromSnapshot(snapshot: SiteTrustSnapshotLike) {
  return {
    self: snapshot.self?.length ?? 0,
    agent: snapshot.agent?.length ?? 0,
    community: snapshot.community?.length ?? 0,
    escrowReports: snapshot.escrowReports?.length ?? 0,
  };
}

/**
 * Snapshot publico del sitio propio en este momento. Devuelve null si el
 * store no esta disponible (nunca bloquea la firma de una imagen).
 */
export async function captureSiteTrust(
  env: Record<string, unknown>,
  deps: CaptureTrustDeps = {}
): Promise<ImageTrust | null> {
  try {
    const createTrustStore =
      deps.createTrustStore ??
      (async (realEnv: Record<string, unknown>) => {
        const { createSiteTrustScoreStore } = await import("../../trust-layer/src/site-trust/store-factory");
        return createSiteTrustScoreStore(realEnv) as Promise<TrustStoreLike>;
      });
    const store = await createTrustStore(env);
    const snapshot = await store.getSnapshot(IMAGE_SITE_ID);
    const now = deps.now ?? (() => new Date());
    return {
      siteId: IMAGE_SITE_ID,
      counts: countsFromSnapshot(snapshot),
      projection: projectTrustView(scoreSiteDimensions(snapshot as never), false),
      computedAt: now().toISOString(),
    };
  } catch {
    return null;
  }
}
