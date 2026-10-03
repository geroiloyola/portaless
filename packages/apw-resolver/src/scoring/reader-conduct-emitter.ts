// packages/apw-resolver/src/scoring/reader-conduct-emitter.ts
//
// Emision de reader_conduct (LTP v1.2, 6.4; ERRATA E-9) a partir de un
// periodo del ledger. Nucleo puro: firma, historial y DNS entran como
// dependencias, asi el endpoint admin solo cablea.
//
// Por cada agente del periodo:
//   1. Sin readerDid -> no se emite (no_reader_did).
//   2. El readerDid del propio sitio -> no se emite (self).
//   3. `k` del TXT del lector debe ser operatorKeyId (la huella con la que
//      firmo las requests). Si no hay TXT o no coincide, no se emite: nadie
//      recibe reputacion usando un Signature-Agent ajeno.
//   4. conductFor() decide las categorias; conductJti() hace el jti
//      determinista, asi repetir la emision del periodo no duplica nada.
//
// El periodo es el del ledger (mensual). emissionPeriod distinto de "month"
// requiere un ledger con esa granularidad (ver reader-conduct-config.ts).

import type { UsageLogPeriod } from "../../../trust-layer/src/ledger/log-schema";
import { ATTESTATION_TYP } from "../did-apw/site-jws";
import { conductFor, conductJti } from "./reader-conduct-config";

export interface ConductSigner {
  /** did:apw:<este sitio> */
  did: string;
  sign(payload: Record<string, unknown>): Promise<string>;
}

export interface EmitReaderConductDeps {
  signer: ConductSigner;
  /** `k` del TXT _apw.<host>, o null. */
  resolveTxtKey(host: string): Promise<string | null>;
  alreadyEmitted(jti: string): Promise<boolean>;
  /** Guarda el JWS emitido (y lo anota en el historial propio). */
  record(jws: string, jti: string, readerDid: string): Promise<void>;
  nowMs?: number;
}

export type EmitSkipReason = "no_reader_did" | "self" | "reader_without_apw" | "key_not_bound_to_apw" | "already_emitted" | "no_conduct";

export interface EmitReaderConductResult {
  period: string;
  emitted: Array<{ readerDid: string; cat: string; jti: string }>;
  skipped: Array<{ operatorKeyId: string; readerDid: string | null; reason: EmitSkipReason; cat?: string }>;
}

export async function emitReaderConduct(period: UsageLogPeriod, deps: EmitReaderConductDeps): Promise<EmitReaderConductResult> {
  const out: EmitReaderConductResult = { period: period.period, emitted: [], skipped: [] };
  const iat = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const keyCache = new Map<string, string | null>();

  for (const agent of period.agents) {
    const readerDid = agent.readerDid ?? null;
    const skip = (reason: EmitSkipReason, cat?: string) => out.skipped.push({ operatorKeyId: agent.operatorKeyId, readerDid, reason, cat });

    if (!readerDid || !readerDid.startsWith("did:apw:")) { skip("no_reader_did"); continue; }
    if (readerDid === deps.signer.did) { skip("self"); continue; }

    const host = readerDid.slice("did:apw:".length);
    if (!keyCache.has(host)) keyCache.set(host, await deps.resolveTxtKey(host).catch(() => null));
    const k = keyCache.get(host);
    if (!k) { skip("reader_without_apw"); continue; }
    if (k !== agent.operatorKeyId) { skip("key_not_bound_to_apw"); continue; }

    const conduct = conductFor({ requestsTotal: agent.requestsTotal, policyViolationsDetected: agent.policyViolationsDetected });
    if (conduct.length === 0) { skip("no_conduct"); continue; }

    for (const { cat, val } of conduct) {
      const jti = await conductJti(deps.signer.did, readerDid, period.period, cat);
      if (await deps.alreadyEmitted(jti)) { skip("already_emitted", cat); continue; }
      const jws = await deps.signer.sign({
        typ: ATTESTATION_TYP,
        iss: deps.signer.did,
        sub: readerDid,
        src: "reader_conduct",
        cat,
        val,
        iat,
        jti,
      });
      await deps.record(jws, jti, readerDid);
      out.emitted.push({ readerDid, cat, jti });
    }
  }
  return out;
}
