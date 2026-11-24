// Pure APW site-history recorder port (L1).
// Environment-backed factory `recordInSiteHistory(env, ...)` lives in
// `@portaless/trust-storage-adapters` (Node-L0).

import type { SiteIdentityStore } from "./site-identity-store";
import { appendAttestation } from "./history-log";
import { LOG_DUPLICATE_ATTESTATION, type AttestationLogStore } from "./attestation-log-store";

const SITE_ID = "default";

export interface HistoryRecordResult {
  logged: boolean;
  reason?: "site_identity_not_found" | "subject_not_this_site" | "already_logged" | "history_error";
  seq?: number;
}

export interface SiteHistoryRecorderDeps {
  identityStore: SiteIdentityStore;
  logStore: AttestationLogStore;
  siteId?: string;
}

export async function recordInSiteHistoryWithStores(
  deps: SiteHistoryRecorderDeps,
  subjectDid: string,
  attestationJws: string,
): Promise<HistoryRecordResult> {
  const siteId = deps.siteId ?? SITE_ID;
  try {
    const identity = await deps.identityStore.get(siteId);
    if (!identity) return { logged: false, reason: "site_identity_not_found" };
    if (identity.did !== subjectDid) return { logged: false, reason: "subject_not_this_site" };
    const entry = await appendAttestation(
      { identity: deps.identityStore, log: deps.logStore, siteId },
      attestationJws,
    );
    return { logged: true, seq: entry.seq };
  } catch (err) {
    if ((err as Error)?.message === LOG_DUPLICATE_ATTESTATION) return { logged: true, reason: "already_logged" };
    console.warn(`[Portaless APW] No se pudo anotar la atestacion en el historial: ${(err as Error)?.message}`);
    return { logged: false, reason: "history_error" };
  }
}
