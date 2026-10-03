// packages/apw-resolver/src/scoring/reader-conduct-config.ts
//
// UNICO lugar donde se ajusta reader_conduct (LTP v1.2, 6.4; ERRATA E-9).
// El resto del codigo lee estos valores y no los repite. Cada ajuste tiene un
// test en tests/unit/apw-reader-conduct-config.test.ts: si se cambia sin
// querer, CI muestra que comportamiento cambio.
//
// Como actualizar (ver tambien ERRATA E-9, "Como actualizar"):
//   - Emitir mas seguido: emissionPeriod = "week" o "day". El jti se deriva
//     del periodo, asi que la emision sigue siendo idempotente.
//   - Nueva categoria (rate_respected, paid_as_agreed, redistribution): agregar
//     una regla en CONDUCT_RULES cuando el ledger registre el dato.
//   - Exigir R-05: policyDimensions["R-05"] = true. La tabla
//     site_trust_read_policies ya tiene min_r05 / min_r05_weight: sin migracion.
//   - Endurecer historiales viejos: legacyEntriesWithoutJws = "reject".
//   - Mover la fecha de corte: legacyCutoff (solo hacia atras; ver E-9).

import { sha256B64Url } from "../did-apw/history-log";

export type EmissionPeriod = "month" | "week" | "day";

export const READER_CONDUCT_CONFIG = Object.freeze({
  /** Una atestacion por lector, por categoria y por periodo. */
  emissionPeriod: "month" as EmissionPeriod,
  /**
   * Dimensiones que exige la politica de lectura. R-05 arranca apagada: un sitio
   * solo ve sus atestaciones y las del historial del lector, no alcanza para
   * calibrar evaluadores (A.4.3). Encender cuando haya indices o testigos.
   */
  policyDimensions: Object.freeze({ "R-01": true, "R-05": false }),
  /** Maximo de reader_conduct del lector que se verifican por resolucion (las mas recientes). */
  maxAttestationsLoaded: 200,
  /**
   * Entradas del historial sin JWS publicado y con ts anterior a legacyCutoff.
   * "ignore": no cuentan para la reputacion ni rompen la completitud.
   * "reject": el lector queda apw_unresolvable.
   * Despues de legacyCutoff, una entrada sin JWS siempre rompe la completitud.
   */
  legacyEntriesWithoutJws: "ignore" as "ignore" | "reject",
  /** Desde esta fecha (UTC) toda entrada debe publicar su JWS (E-9). */
  legacyCutoff: "2026-10-04T00:00:00.000Z",
});

/** Lo que el ledger sabe de un lector en un periodo. */
export interface LedgerConductInput {
  requestsTotal: number;
  policyViolationsDetected: number;
}

export interface ConductRule {
  cat: "respected_policy" | "policy_violation" | "rate_respected" | "paid_as_agreed" | "redistribution";
  val: boolean;
  when: (e: LedgerConductInput) => boolean;
}

/** Una regla por categoria. Agregar aqui las nuevas cuando el ledger tenga el dato. */
export const CONDUCT_RULES: ReadonlyArray<ConductRule> = Object.freeze([
  { cat: "policy_violation", val: true, when: (e) => e.policyViolationsDetected > 0 },
  { cat: "respected_policy", val: true, when: (e) => e.requestsTotal > 0 && e.policyViolationsDetected === 0 },
]);

export function conductFor(e: LedgerConductInput): Array<{ cat: ConductRule["cat"]; val: boolean }> {
  return CONDUCT_RULES.filter((r) => r.when(e)).map(({ cat, val }) => ({ cat, val }));
}

/** Clave del periodo en UTC: month YYYY-MM, day YYYY-MM-DD, week ISO YYYY-Www. */
export function periodKey(date: Date, period: EmissionPeriod = READER_CONDUCT_CONFIG.emissionPeriod): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (period === "month") return `${y}-${m}`;
  if (period === "day") return `${y}-${m}-${d}`;
  const t = new Date(Date.UTC(y, date.getUTCMonth(), date.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const isoYear = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(isoYear, 0, 1)) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** jti determinista: repetir la emision del mismo periodo no duplica atestaciones. */
export async function conductJti(issuerDid: string, readerDid: string, period: string, cat: string): Promise<string> {
  return `rc-${await sha256B64Url(`${issuerDid}|${readerDid}|${period}|${cat}`)}`;
}
