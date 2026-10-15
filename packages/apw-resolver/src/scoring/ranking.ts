/**
 * Ranking de sujetos (Fase 9a, ROADMAP "Federated query" item 3): el orden
 * debe poder RECOMPUTARSE por un tercero a partir de las mismas atestaciones
 * firmadas. Modulo puro y determinista: sin I/O, sin reloj, sin storage. El
 * unico hash que calcula (inputHash) es sobre el conjunto de entrada, para que
 * omitir atestaciones sea visible.
 *
 * DISENO (por que asi, no de otra forma):
 *
 *  - UNA SOLA CLAVE TEMPORAL: `observedAt` es el `ts` de la entrada del
 *    testigo que cubre el statement (fecha creible, anclada por el DNS del
 *    testigo, ver 5.7). Orden Y ventana usan ESA clave, nunca el `iat` del
 *    emisor: el `iat` lo declara quien firma, asi que ordenar por el seria
 *    backdating por la puerta de atras. Una entrada SIN observacion que la
 *    cubra (`observedAt` ausente) queda FUERA de la ventana y FUERA del orden,
 *    explicito -- no hay valor por defecto.
 *
 *  - INSTANTE FIJO: toda consulta lleva `asOf` (epoch segundos). No hay
 *    "ahora" implicito: sin `asOf` el orden no es recomputable.
 *
 *  - ORDEN TOTAL Y DETERMINISTA: los puntajes se redondean a
 *    RANKING_PRECISION decimales y se comparan con tolerancia RANKING_EPSILON
 *    (mismo espiritu que la regla de v-08: ((6.7-1)/6)^2 no es exacto en
 *    IEEE-754). El empate se rompe por la tupla completa
 *    (score desc, weightSum desc, count desc, subject asc) -- el DID es el
 *    ULTIMO criterio, no el unico.
 *
 *  - ESTADO VACIO HONESTO: `top` NO rellena con el prior neutro (4.0). Un
 *    sujeto sin peso suficiente (weightSum < minWeight) NO aparece. En una red
 *    joven eso significa que `top` casi no tiene entradas: es el dato, no un
 *    bug.
 *
 * `confidence` es la unica excepcion a la clave temporal: usa el `seq`
 * declarado (consenso de testigos SOBRE ese seq), no una ventana. Nunca mezcla
 * las dos nociones en una misma respuesta.
 */

import { sha256B64Url } from "../did-apw/history-log";
import { bayesianScore } from "./scoring";
import { COMMUNITY_MIN_WEIGHT_DEFAULT } from "./community";

export const RANKING_FILTERS = ["top", "confidence", "recents", "new", "old", "history"] as const;
export type RankingFilter = (typeof RANKING_FILTERS)[number];

/** Decimales a los que se redondea todo puntaje antes de comparar. */
export const RANKING_PRECISION = 6;
/** Tolerancia bajo la cual dos puntajes redondeados se consideran iguales. */
export const RANKING_EPSILON = 1e-9;

/** Una entrada rankeable: una atestacion/testimonio anclado a una observacion verificada. */
export interface RankingEntry {
  /** Sujeto: `did:apw:<dominio>` o el id que use el llamador. */
  subject: string;
  /** Emisor/testigo que firmo la entrada. */
  issuer: string;
  /**
   * Epoch segundos del `ts` de la entrada del testigo que cubre esta entrada
   * (fecha creible). REQUERIDO: sin el, la entrada se excluye.
   */
  observedAt: number;
  /** Peso A.4.2 ya calibrado de esta entrada. */
  weight: number;
  /** Valor 1..7 ya normalizado (lo usan los filtros de puntaje: `top`). */
  value?: number;
  /** `seq` observado (lo usa `confidence`). */
  seq?: number;
  /** Cabeza observada en ese `seq` (lo usa `confidence`). */
  head?: string | null;
}

export interface RankingQuery {
  filter: RankingFilter;
  /** Epoch segundos; el instante de evaluacion. Obligatorio. */
  asOf: number;
  /** Ventana hacia atras en segundos. Obligatoria para `top`. */
  windowSeconds?: number;
  /** `seq` declarado. Obligatorio para `confidence`. */
  seq?: number;
  /** Peso minimo para entrar a `top` (default COMMUNITY_MIN_WEIGHT_DEFAULT = 2.0). */
  minWeight?: number;
}

export interface RankedSubject {
  subject: string;
  /** Puntaje redondeado a RANKING_PRECISION decimales. */
  score: number;
  /** Suma de pesos de las entradas que contribuyeron. */
  weightSum: number;
  /** Cantidad de entradas que contribuyeron. */
  count: number;
  /** Clave temporal del sujeto: max observedAt (recents/top) o min (new/old). */
  observedAt: number;
  /** Presente solo en `confidence`. */
  seq?: number;
  /** Presente solo en `confidence`: cabeza ganadora en el seq declarado. */
  head?: string | null;
}

export interface RankingResult {
  filter: RankingFilter;
  asOf: number;
  windowSeconds: number | null;
  minWeight: number;
  /** Entradas admitidas (con `observedAt` resuelto). */
  admissible: number;
  /** Entradas descartadas por no tener observacion que las cubra. */
  excludedWithoutObservation: number;
  /** sha256 del conjunto admisible, serializado de forma canonica. */
  inputHash: string;
  order: RankedSubject[];
}

function round(x: number): number {
  const f = 10 ** RANKING_PRECISION;
  return Math.round(x * f) / f;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= RANKING_EPSILON;
}

/** Comparador de score: tupla total (score desc, weightSum desc, count desc, subject asc). */
function byScore(a: RankedSubject, b: RankedSubject): number {
  if (!approxEqual(a.score, b.score)) return b.score - a.score;
  if (!approxEqual(a.weightSum, b.weightSum)) return b.weightSum - a.weightSum;
  if (a.count !== b.count) return b.count - a.count;
  return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
}

function hasObservation(e: RankingEntry): boolean {
  return typeof e.observedAt === "number" && Number.isFinite(e.observedAt);
}

/**
 * Consenso de testigos sobre un `seq` declarado: la cabeza con mas peso entre
 * las observaciones de ESE seq. Misma regla que `consensusOf` del Index
 * (witness-index.ts), duplicada a proposito para que este modulo no arrastre
 * el grafo del store (que romperia el entry point standalone). Desempate por
 * cabeza lexicografica.
 */
function consensusHeadAtSeq(
  observations: ReadonlyArray<RankingEntry>,
  seq: number
): { head: string | null; weight: number } | null {
  let found = false;
  const byHead = new Map<string, { head: string | null; weight: number }>();
  for (const obs of observations) {
    if (obs.seq !== seq) continue;
    found = true;
    const key = obs.head ?? "";
    const slot = byHead.get(key) ?? { head: obs.head ?? null, weight: 0 };
    slot.weight += obs.weight;
    byHead.set(key, slot);
  }
  if (!found) return null;
  const ranked = [...byHead.values()].sort((a, b) =>
    b.weight !== a.weight ? b.weight - a.weight : String(a.head) < String(b.head) ? -1 : 1
  );
  return { head: ranked[0].head, weight: ranked[0].weight };
}

/** Serializacion canonica del conjunto admisible, para el inputHash. */
function canonicalEntries(entries: ReadonlyArray<RankingEntry>): string {
  const rows = entries.map((e) => [
    e.subject,
    e.issuer,
    e.observedAt,
    e.weight,
    typeof e.value === "number" ? e.value : null,
    typeof e.seq === "number" ? e.seq : null,
    e.head ?? null,
  ]);
  rows.sort((a, b) => {
    const ka = a.map((x) => String(x)).join("\u0000");
    const kb = b.map((x) => String(x)).join("\u0000");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return JSON.stringify(rows);
}

/**
 * hash del conjunto admisible (entradas con observacion resuelta). Un nodo no
 * puede omitir atestaciones sin que el hash cambie.
 */
export function rankingInputHash(entries: ReadonlyArray<RankingEntry>): Promise<string> {
  return sha256B64Url(canonicalEntries(entries.filter(hasObservation)));
}

/**
 * Orden puro y determinista (sin el hash, que es I/O de crypto). Separado de
 * `rankSubjects` para que un vector pueda comprobarlo sincronicamente.
 */
export function rankOrder(query: RankingQuery, entries: ReadonlyArray<RankingEntry>): Omit<RankingResult, "inputHash"> {
  if (!RANKING_FILTERS.includes(query.filter)) throw new RangeError(`filtro de ranking desconocido: ${query.filter}`);
  if (typeof query.asOf !== "number" || !Number.isFinite(query.asOf)) throw new TypeError("asOf es obligatorio (epoch segundos)");

  const minWeight = typeof query.minWeight === "number" ? query.minWeight : COMMUNITY_MIN_WEIGHT_DEFAULT;
  const admissible = entries.filter(hasObservation);
  const excludedWithoutObservation = entries.length - admissible.length;

  let order: RankedSubject[];

  if (query.filter === "confidence") {
    if (typeof query.seq !== "number" || !Number.isFinite(query.seq)) throw new TypeError("confidence requiere seq");
    const bySubject = new Map<string, RankingEntry[]>();
    for (const e of admissible) {
      if (e.seq !== query.seq) continue;
      if (e.observedAt > query.asOf) continue;
      const list = bySubject.get(e.subject);
      if (list) list.push(e); else bySubject.set(e.subject, [e]);
    }
    order = [];
    for (const [subject, obs] of bySubject) {
      const consensus = consensusHeadAtSeq(obs, query.seq);
      if (!consensus) continue;
      let weightSum = 0;
      for (const o of obs) weightSum += o.weight;
      order.push({
        subject,
        score: round(consensus.weight),
        weightSum,
        count: obs.length,
        observedAt: Math.max(...obs.map((o) => o.observedAt)),
        seq: query.seq,
        head: consensus.head,
      });
    }
  } else if (query.filter === "top") {
    if (typeof query.windowSeconds !== "number" || !Number.isFinite(query.windowSeconds)) {
      throw new TypeError("top requiere windowSeconds");
    }
    const from = query.asOf - query.windowSeconds;
    const bySubject = new Map<string, RankingEntry[]>();
    for (const e of admissible) {
      if (typeof e.value !== "number") continue;
      if (e.observedAt < from || e.observedAt > query.asOf) continue;
      const list = bySubject.get(e.subject);
      if (list) list.push(e); else bySubject.set(e.subject, [e]);
    }
    order = [];
    for (const [subject, items] of bySubject) {
      const scored = bayesianScore(items.map((e) => ({ weight: e.weight, value: e.value as number })));
      // Estado vacio honesto: sin peso suficiente NO se rellena con el prior.
      if (scored.weightSum < minWeight) continue;
      order.push({
        subject,
        score: round(scored.score),
        weightSum: round(scored.weightSum),
        count: scored.count,
        observedAt: Math.max(...items.map((e) => e.observedAt)),
      });
    }
  } else {
    // Filtros por posicion observada (una sola clave temporal). `asOf` acota
    // el conjunto considerado: una observacion posterior a asOf no existia en
    // ese instante y no entra al orden.
    const bySubject = new Map<string, number[]>();
    for (const e of admissible) {
      if (e.observedAt > query.asOf) continue;
      const list = bySubject.get(e.subject);
      if (list) list.push(e.observedAt); else bySubject.set(e.subject, [e.observedAt]);
    }
    order = [];
    for (const [subject, times] of bySubject) {
      const first = Math.min(...times);
      const last = Math.max(...times);
      const count = times.length;
      if (query.filter === "recents") order.push({ subject, score: last, weightSum: 0, count, observedAt: last });
      else if (query.filter === "new") order.push({ subject, score: first, weightSum: 0, count, observedAt: first });
      else if (query.filter === "old") order.push({ subject, score: first, weightSum: 0, count, observedAt: first });
      else order.push({ subject, score: count, weightSum: 0, count, observedAt: last }); // history
    }
  }

  // Comparadores por filtro. Los de puntaje usan la tupla total; los de tiempo
  // usan la clave temporal y desempatan por subject.
  if (query.filter === "top" || query.filter === "confidence") {
    order.sort(byScore);
  } else if (query.filter === "recents" || query.filter === "new") {
    order.sort((a, b) => (a.observedAt !== b.observedAt ? b.observedAt - a.observedAt : a.subject < b.subject ? -1 : 1));
  } else if (query.filter === "old") {
    order.sort((a, b) => (a.observedAt !== b.observedAt ? a.observedAt - b.observedAt : a.subject < b.subject ? -1 : 1));
  } else {
    // history: mas documentados primero; luego actividad reciente; luego subject.
    order.sort((a, b) =>
      a.count !== b.count ? b.count - a.count : a.observedAt !== b.observedAt ? b.observedAt - a.observedAt : a.subject < b.subject ? -1 : 1
    );
  }

  return {
    filter: query.filter,
    asOf: query.asOf,
    windowSeconds: typeof query.windowSeconds === "number" ? query.windowSeconds : null,
    minWeight,
    admissible: admissible.length,
    excludedWithoutObservation,
    order,
  };
}

/** Resultado completo, con el hash del conjunto admisible. */
export async function rankSubjects(query: RankingQuery, entries: ReadonlyArray<RankingEntry>): Promise<RankingResult> {
  const base = rankOrder(query, entries);
  const inputHash = await rankingInputHash(entries);
  return { ...base, inputHash };
}
