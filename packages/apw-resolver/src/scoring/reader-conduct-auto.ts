// packages/apw-resolver/src/scoring/reader-conduct-auto.ts
//
// Emision AUTOMATICA de reader_conduct (APW v1.3, 6.4; ERRATA E-9/E-10).
// Mismo nucleo que el endpoint admin (emitReaderConduct), pero disparada por
// el Trust Layer cada vez que registra un acceso verificado con readerDid
// candidato (functions/_middleware.js). El endpoint admin queda para
// backfill de periodos viejos y para el caso manual con step-up.
//
// Seguridad (por que NO necesita step-up):
//   - la unica entrada es operatorKeyId, ya registrada en el ledger por el
//     middleware con la firma verificada; no hay parametros de usuario;
//   - se emite EXACTAMENTE lo que el ledger dice de ese agente en el periodo
//     (conductFor), con el jti determinista de E-9: repetir no duplica;
//   - el lector debe tener `k` === operatorKeyId en su TXT (mismo chequeo
//     que la emision manual): nadie recibe reputacion con un Signature-Agent
//     ajeno.
// El coste por request en el camino caliente es un SELECT sobre
// reader_conduct_jti (jtiStore.has); el DoH contra el TXT del lector solo
// ocurre cuando hay algo nuevo que emitir (una vez por lector, por periodo).
//
// Opt-out: env.APW_AUTO_EMIT_CONDUCT = "false" desactiva la emision
// automatica (la manual del admin sigue disponible).

import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AttestationLogStore } from "../did-apw/attestation-log-store";
import type { SiteIdentityStore } from "../did-apw/site-identity-store";
import { appendAttestation } from "../did-apw/history-log";
import { ATTESTATION_TYP, signSiteJws } from "../did-apw/site-jws";
import { emitReaderConduct, type EmitReaderConductResult } from "./reader-conduct-emitter";
import { conductFor, periodKey } from "./reader-conduct-config";
import {
  collectEmittedJtis,
  type ReaderConductJtiStore,
} from "./reader-conduct-jti-store";

export const SITE_ID = "default";

export interface AutoEmitDeps {
  identity: SiteIdentityStore;
  log: AttestationLogStore;
  ledger: UsageLedgerStore;
  jtiStore: ReaderConductJtiStore;
  resolveTxtKey(host: string): Promise<string | null>;
  nowMs?: number;
}

/**
 * Emite (si corresponde) las reader_conduct del agente en el periodo actual.
 * Devuelve null cuando no hay nada que considerar (sin ledger, sin readerDid,
 * sin conducta, sin identidad); EmitReaderConductResult cuando corrio el
 * emisor (emitted puede ser vacio: ya_emitido / lector sin APW / etc.).
 */
export async function maybeAutoEmitReaderConduct(deps: AutoEmitDeps, operatorKeyId: string): Promise<EmitReaderConductResult | null> {
  const nowMs = deps.nowMs ?? Date.now();
  const period = periodKey(new Date(nowMs));

  const periodData = await deps.ledger.get(period);
  const agent = periodData?.agents.find((a) => a.operatorKeyId === operatorKeyId);
  if (!agent || !agent.readerDid || !agent.readerDid.startsWith("did:apw:")) return null;

  const conduct = conductFor({
    requestsTotal: agent.requestsTotal,
    policyViolationsDetected: agent.policyViolationsDetected,
  });
  if (conduct.length === 0) return null;

  const record = await deps.identity.get(SITE_ID);
  const key = record ? await deps.identity.getActiveSigningKey(SITE_ID) : null;
  if (!record || !key) return null;

  let seeded: Set<string> | null = null;
  const alreadyEmitted = async (jti: string): Promise<boolean> => {
    if (await deps.jtiStore.has(SITE_ID, jti)) return true;
    // Base migrada: el jti puede existir en el historial sin estar en la
    // tabla nueva. Se reconcilia una vez (lazily) desde att_jws (E-9).
    if (seeded === null) seeded = await collectEmittedJtis(deps.log, SITE_ID, record.did);
    if (seeded.has(jti)) {
      await deps.jtiStore.add({ siteId: SITE_ID, jti, period, cat: "seed", readerDid: agent.readerDid!, createdAt: new Date(nowMs).toISOString() });
      return true;
    }
    return false;
  };

  return emitReaderConduct(
    { period: periodData!.period, generatedAt: periodData!.generatedAt, agents: [agent] },
    {
      signer: {
        did: record.did,
        sign: (payload) => signSiteJws(payload, { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }, ATTESTATION_TYP),
      },
      resolveTxtKey: deps.resolveTxtKey,
      alreadyEmitted,
      record: async (jws, jti) => {
        await appendAttestation({ identity: deps.identity, log: deps.log, siteId: SITE_ID }, jws);
        await deps.jtiStore.add({ siteId: SITE_ID, jti, period, cat: "emitted", readerDid: agent.readerDid!, createdAt: new Date(nowMs).toISOString() });
      },
      nowMs,
    }
  );
}
