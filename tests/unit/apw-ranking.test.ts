// Ranking (Fase 9a): orden total y determinista, una sola clave temporal,
// estado vacio honesto y hash del conjunto usado. Los valores normativos
// estan en V-16; aca se cubren los errores de contrato y las invariantes.
import { describe, it, expect } from "vitest";
import {
  rankOrder,
  rankSubjects,
  rankingInputHash,
  RANKING_FILTERS,
  RANKING_PRECISION,
  RANKING_EPSILON,
} from "../../packages/apw-resolver/src/scoring/ranking";
import type { RankingEntry } from "../../packages/apw-resolver/src/scoring/ranking";

const e = (subject: string, observedAt: number, extra: Partial<RankingEntry> = {}): RankingEntry => ({
  subject,
  issuer: `did:apw:${subject.split(":")[2] ?? "i"}`,
  observedAt,
  weight: 1,
  ...extra,
});

describe("rankOrder: contrato", () => {
  it("rechaza un filtro desconocido", () => {
    expect(() => rankOrder({ filter: "bogus" as never, asOf: 1 }, [])).toThrow();
    expect(RANKING_FILTERS).toEqual(["top", "confidence", "recents", "new", "old", "history"]);
  });

  it("exige asOf, ventana para top y seq para confidence", () => {
    expect(() => rankOrder({ filter: "recents", asOf: NaN }, [])).toThrow(/asOf/);
    expect(() => rankOrder({ filter: "top", asOf: 1 }, [])).toThrow(/windowSeconds/);
    expect(() => rankOrder({ filter: "confidence", asOf: 1 }, [])).toThrow(/seq/);
  });

  it("exporta la precision y la tolerancia documentadas", () => {
    expect(RANKING_PRECISION).toBe(6);
    expect(RANKING_EPSILON).toBe(1e-9);
  });
});

describe("top: estado vacio honesto", () => {
  it("no rellena un sujeto sin peso suficiente con el prior neutro", () => {
    const entries = [e("a", 1, { value: 5, weight: 0.25 })];
    const empty = rankOrder({ filter: "top", asOf: 100, windowSeconds: 1000 }, entries);
    expect(empty.order).toEqual([]);
    // Con minWeight explicito bajo, aparece con SU puntaje (no con 4.0).
    const shown = rankOrder({ filter: "top", asOf: 100, windowSeconds: 1000, minWeight: 0.1 }, entries);
    expect(shown.order).toHaveLength(1);
    expect(shown.order[0].score).toBe(round6((3 * 4 + 0.25 * 5) / (3 + 0.25)));
  });

  it("una entrada sin `value` no contribuye a top", () => {
    const r = rankOrder({ filter: "top", asOf: 100, windowSeconds: 1000, minWeight: 0.1 }, [e("a", 1, { weight: 5 })]);
    expect(r.order).toEqual([]);
  });
});

describe("determinismo", () => {
  const entries = [e("b", 10, { value: 5 }), e("a", 20, { value: 4 }), e("c", 15, { value: 6 })];

  it("el orden es independiente del orden de entrada", () => {
    const q = { filter: "top" as const, asOf: 100, windowSeconds: 1000, minWeight: 0.1 };
    const first = rankOrder(q, entries).order;
    const shuffled = rankOrder(q, [...entries].reverse()).order;
    expect(shuffled).toEqual(first);
  });

  it("rankingInputHash es invariante ante permutaciones", async () => {
    expect(await rankingInputHash(entries)).toBe(await rankingInputHash([...entries].reverse()));
  });

  it("rankingInputHash cambia si se omite una atestacion", async () => {
    expect(await rankingInputHash(entries)).not.toBe(await rankingInputHash(entries.slice(0, 2)));
  });

  it("rankingInputHash ignora las entradas sin observacion", async () => {
    const withNoise = [...entries, { subject: "z", issuer: "did:apw:z", observedAt: NaN, weight: 9 } as RankingEntry];
    expect(await rankingInputHash(withNoise)).toBe(await rankingInputHash(entries));
  });
});

describe("rankSubjects: resultado completo", () => {
  it("incluye el hash y los contadores de admisibilidad", async () => {
    const entries = [e("a", 1, { value: 5 }), { subject: "b", issuer: "i", observedAt: NaN, weight: 1 } as RankingEntry];
    const result = await rankSubjects({ filter: "top", asOf: 100, windowSeconds: 1000, minWeight: 0.1 }, entries);
    expect(result.admissible).toBe(1);
    expect(result.excludedWithoutObservation).toBe(1);
    expect(typeof result.inputHash).toBe("string");
    expect(result.inputHash.length).toBeGreaterThan(0);
    expect(result.filter).toBe("top");
    expect(result.asOf).toBe(100);
    expect(result.windowSeconds).toBe(1000);
  });

  it("acota por asOf: una observacion futura no entra al orden", async () => {
    const entries = [e("a", 10), e("b", 500)];
    const r = rankOrder({ filter: "recents", asOf: 100 }, entries);
    expect(r.admissible).toBe(2);
    expect(r.order.map((o) => o.subject)).toEqual(["a"]);
  });
});

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
