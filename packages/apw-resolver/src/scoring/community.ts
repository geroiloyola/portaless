/**
 * Predicado comunitario (APW E-13, sobre 6.7): emisor distinto, antiguedad
 * minima del emisor y `min_weight`. Funciones puras: sin I/O, sin reloj,
 * deterministas.
 *
 * La antiguedad del emisor se recibe YA resuelta en `emitterFirstSeenIat`:
 * quien escribe la atestacion resuelve el historial encadenado del emisor
 * (5.4) y guarda el `ts` de su primera entrada verificada. Aca solo se
 * compara contra el `iat` de la atestacion, porque resolver un historial es
 * I/O y este modulo tiene que poder probarse con vectores.
 *
 * Fail-closed: un emisor cuyo historial no se pudo resolver
 * (`emitterFirstSeenIat` ausente) NO acredita antiguedad. La defensa de 6.7
 * es un piso, y sin dato no hay piso.
 */

import { issuerWeight, NEUTRAL } from './scoring';

/** E-13: `min_weight` del predicado comunitario, por (sujeto, categoria). */
export const COMMUNITY_MIN_WEIGHT_DEFAULT = 2.0;
/** E-13: antiguedad minima del historial del emisor, en dias. */
export const COMMUNITY_MIN_AGE_DAYS_DEFAULT = 7;
export const SECONDS_PER_DAY = 86400;

/** Fila comunitaria tal como la consume el predicado. */
export interface CommunityRow {
  /** `did:apw` del emisor (el Veracier); su clave es la unica identidad valida. */
  iss: string;
  category: string;
  /** `val` de la atestacion: entero 1..5 (E-13). */
  val: number;
  /** `iat` de la atestacion, en segundos. */
  iat: number;
  /** `jti` unico por emisor (5.3); desempata la deduplicacion. */
  jti: string;
  /** Primera entrada verificada del historial del emisor, en segundos. */
  emitterFirstSeenIat?: number | null;
}

export interface CommunityPredicate {
  /** Emisores distintos que sobreviven a deduplicacion y umbral de antiguedad. */
  emitters: number;
  /** Suma de pesos A.4.2 de esos emisores. */
  weightSum: number;
  /** `weightSum >= minWeight`: la categoria puntua o no (E-13). */
  passes: boolean;
  /** Filas que puntuan, ya deduplicadas y filtradas por antiguedad. */
  rows: CommunityRow[];
}

/**
 * E-13: un emisor acredita antiguedad solo si su historial verificado arranco
 * hace al menos `minDays` respecto del `iat` de la atestacion. Sin
 * `emitterFirstSeenIat` resuelto, no acredita (fail-closed).
 */
export function emitterAgeOk(
  iat: number,
  firstSeenIat: number | null | undefined,
  minDays: number = COMMUNITY_MIN_AGE_DAYS_DEFAULT
): boolean {
  if (typeof firstSeenIat !== 'number' || !Number.isFinite(firstSeenIat)) return false;
  return iat - firstSeenIat >= minDays * SECONDS_PER_DAY;
}

/**
 * E-13: de cada `(iss, categoria)` cuenta solo la atestacion mas reciente.
 * No es la primera ni la suma: reemitir reemplaza. El desempate por `jti`
 * mantiene la funcion determinista cuando dos atestaciones comparten `iat`.
 */
export function latestPerEmitter(rows: ReadonlyArray<CommunityRow>): CommunityRow[] {
  const best = new Map<string, CommunityRow>();
  for (const row of rows) {
    const key = `${row.iss}\u0000${row.category}`;
    const current = best.get(key);
    if (!current || row.iat > current.iat || (row.iat === current.iat && row.jti > current.jti)) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

/**
 * Predicado de UNA categoria (`rows` ya viene filtrado). Aplica deduplicacion
 * por emisor, umbral de antiguedad y suma de pesos A.4.2. `judges` es el mapa
 * de calibracion (iss -> J); sin emisor comparable, J = 4.0 y w = 0.25.
 *
 * `minWeight` aplica POR (sujeto, categoria), no a la dimension entera: asi no
 * descarta la evidencia de otras fuentes que comparten dimension (W-03 recibe
 * `self.contact_transparency`/`terms_of_service` y `community.responsiveness`).
 */
export function communityPredicate(
  rows: ReadonlyArray<CommunityRow>,
  judges: ReadonlyMap<string, number>,
  minWeight: number = COMMUNITY_MIN_WEIGHT_DEFAULT
): CommunityPredicate {
  const surviving = latestPerEmitter(rows).filter((row) => emitterAgeOk(row.iat, row.emitterFirstSeenIat));
  let weightSum = 0;
  for (const row of surviving) weightSum += issuerWeight(judges.get(row.iss) ?? NEUTRAL);
  return { emitters: surviving.length, weightSum, passes: weightSum >= minWeight, rows: surviving };
}
