// packages/apw-resolver/src/did-apw/record-attestation.ts
//
// Anota en el historial encadenado del sitio (5.4) una atestacion que ya fue
// verificada y guardada en SiteTrustScore (5.3). Solo si el `sub` de la
// atestacion es el DID de ESTE sitio: una atestacion sobre otro siteId se
// guarda en el score pero no entra en este historial.
//
// Nunca lanza: si el historial falla (sin identidad, sin clave de cifrado,
// error de base), el reporte ya quedo guardado y el caller informa
// logged:false. Una atestacion repetida cuenta como ya registrada.

import { createSiteIdentityStore, createAttestationLogStore } from "./store-factory";
import { appendAttestation } from "./history-log";
import { LOG_DUPLICATE_ATTESTATION } from "./attestation-log-store";

const SITE_ID = "default";

export interface HistoryRecordResult {
  logged: boolean;
  reason?: "site_identity_not_found" | "subject_not_this_site" | "already_logged" | "history_error";
  seq?: number;
}

export async function recordInSiteHistory(
  env: Record<string, any>,
  subjectDid: string,
  attestationJws: string
): Promise<HistoryRecordResult> {
  try {
    const identityStore = await createSiteIdentityStore(env);
    const identity = await identityStore.get(SITE_ID);
    if (!identity) return { logged: false, reason: "site_identity_not_found" };
    if (identity.did !== subjectDid) return { logged: false, reason: "subject_not_this_site" };
    const log = await createAttestationLogStore(env);
    const entry = await appendAttestation({ identity: identityStore, log, siteId: SITE_ID }, attestationJws);
    return { logged: true, seq: entry.seq };
  } catch (err) {
    if ((err as Error)?.message === LOG_DUPLICATE_ATTESTATION) return { logged: true, reason: "already_logged" };
    console.warn(`[Portaless APW] No se pudo anotar la atestacion en el historial: ${(err as Error)?.message}`);
    return { logged: false, reason: "history_error" };
  }
}
