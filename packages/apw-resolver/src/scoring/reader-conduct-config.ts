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
//     una regla en CONDUCT_RULES cuando el ledger registre el dato. Ver el
//     comentario de CONDUCT_RULES: hoy el ledger no registra ninguno de los tres.
//   - Exigir R-05: policyDimensions["R-05"] = true. La tabla
//     site_trust_read_policies ya tiene min_r05 / min_r05_weight: sin migracion.
//     ANTES: leer el comentario del campo policyDimensions. El cambio de config
//     solo tiene sentido despues de los dos prerequisitos de datos; hoy
//     encenderlo rechazaria a TODOS los lectores, no a los malos.
//   - Endurecer historiales viejos: legacyEntriesWithoutJws = "reject".
//   - Mover la fecha de corte: legacyCutoff (solo hacia atras; ver E-9).

import { sha256B64Url } from "../did-apw/history-log";

export type EmissionPeriod = "month" | "week" | "day";

export const READER_CONDUCT_CONFIG = Object.freeze({
  /** Una atestacion por lector, por categoria y por periodo. */
  emissionPeriod: "month" as EmissionPeriod,
  /**
   * Dimensiones que exige la politica de lectura. R-05 arranca apagada y no es
   * un ajuste de apariencia: R-05 del sujeto es la calibracion de las atestaciones
   * que EL EMITIO (A.4.4, scoreSubject), y loadReaderConduct solo carga
   * reader_conduct que el lector RECIBIO (descarta iss === lector). Un lector
   * que no emite queda con R-05 = 4.0 y peso 0, asi que con min_r05_weight = 2.0
   * la politica rechazaria a TODOS los lectores (test anclado en
   * tests/unit/apw-reader-conduct-config.test.ts).
   *
   * Para encenderlo hacen falta dos datos que hoy no existen:
   *   1. un flujo en que el lector EMITA atestaciones sobre sujetos (hoy solo
   *      existe el voto community anonimo por IP, sin DID);
   *   2. un corpus de otros emisores sobre el mismo (sujeto, dimension) para el
   *      consenso leave-one-out de A.4.4: indices o testigos (seccion 7).
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

/** Lo que el ledger sabe de un lector en un periodo.
 *  Es literalmente lo que registra log-writer.ts: nada mas. */
export interface LedgerConductInput {
  requestsTotal: number;
  policyViolationsDetected: number;
}

export interface ConductRule {
  cat: "respected_policy" | "policy_violation" | "rate_respected" | "paid_as_agreed" | "redistribution";
  val: boolean;
  when: (e: LedgerConductInput) => boolean;
}

/**
 * Una regla por categoria. Agregar aqui las nuevas cuando el ledger tenga el dato.
 *
 * Las tres pendientes (spec 6.4) y por que el ledger no las tiene hoy:
 *
 *   - rate_respected (R-02): no hay tasa que respetar. PolicyRule solo declara
 *     access / price_usd / unit (policy/manifest-schema.ts); no existe un limite
 *     de peticiones en la politica, ni enforcement (429), ni contador de
 *     rechazos por tasa en el middleware. El unico rate limit del sistema es el
 *     del voto community, que es del visitante, no del lector.
 *
 *   - paid_as_agreed (R-03): el origen no sabe si el crawler pago. Con el unico
 *     proveedor de settlement (Cloudflare Pay Per Crawl, pricing in-band) el
 *     origen devuelve 200 + `crawler-price` y Cloudflare cobra al crawler o le
 *     responde 402 sin volver a pasar por el origen (billing/pay-per-crawl/
 *     cloudflare.ts, "el origen nunca responde el 402 ni sabe si el crawler
 *     pago"). Por eso recordAgentAccess() recibe charged:false en los cuatro
 *     caminos del middleware y requests_charged / revenue_usd no se mueven:
 *     emitir paid_as_agreed de esos campos seria inventar el dato. Haria falta
 *     un proveedor de settlement que informe al origen el resultado.
 *
 *   - redistribution (R-04): no es observable por el origen. El lector puede
 *     copiar y redistribuir lo que leyo (spec: "el protocolo puede registrar
 *     esa conducta si se detecta; no puede impedirla"); detectarlo requiere
 *     testigos o una denuncia de un tercero, no el ledger de accesos.
 *
 * Anclado en tests/unit/apw-reader-conduct-config.test.ts.
 */
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
