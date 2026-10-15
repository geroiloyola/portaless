/**
 * APW conformance runner.
 *
 * Executes the machine-readable test vectors of `APW-VECTORS-v1.3` against the
 * published surface of `@portaless/apw-resolver` and nothing else. That
 * constraint is the whole point: this module imports ONLY from `../src/standalone`
 * (the package entry), never from an internal path. If a function the spec
 * requires is not exported publicly, this runner fails to compile and the suite
 * fails -- which is the correct outcome, because it is exactly the information a
 * third-party implementer needs: the published package is not sufficient yet.
 *
 * The vectors themselves live in `docs/protocol-apw/vectors/v1.3/` and are
 * independent of the code. Nothing here invents an expected value; every
 * expectation is transcribed from the spec.
 */

import {
  jwkThumbprint,
  jcs,
  sha256B64Url,
  didKeyId,
  parseDidKeyId,
  parseApwManifest,
  serializeApwManifest,
  buildApwManifest,
  issuerWeight,
  judgeFromDeviation,
  toValue,
  readerConductToDimension,
  bayesianScore,
  periodKey,
  emitterAgeOk,
  communityPredicate,
  rankOrder,
  rankingInputHash,
  NEUTRAL,
  PRIOR_WEIGHT,
  SELF_WEIGHT,
} from "../src/standalone";

// Imported for the reachability assertion below: these are constants a vector
// asserts, so their presence is part of the public contract.
import * as apw from "../src/standalone";

export type CaseStatus = "pass" | "fail" | "unsupported";

export interface CaseResult {
  vector: string;
  group: string;
  label: string;
  status: CaseStatus;
  detail?: string;
}

export interface VectorReport {
  vector: string;
  title: string;
  specSection: string;
  minimalInterop: boolean;
  total: number;
  passed: number;
  failed: number;
  unsupported: number;
  results: CaseResult[];
}

export interface ConformanceReport {
  spec: string;
  vectorsVersion: string;
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  unsupported: number;
  minimalInteropRequired: string[];
  minimalInteropSatisfied: boolean;
  vectors: VectorReport[];
}

const EPS = 1e-9;

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function readNumber(c: Record<string, unknown>, key: string, fallback = EPS): number {
  const v = c[key];
  return typeof v === "number" ? v : fallback;
}

/** Expands `{ w: "issuerWeight(6.0)", v: 7.0, repeat: 10 }` into concrete items. */
function expandItems(raw: ReadonlyArray<Record<string, unknown>>): Array<{ weight: number; value: number }> {
  const out: Array<{ weight: number; value: number }> = [];
  for (const item of raw) {
    const repeat = typeof item.repeat === "number" ? item.repeat : 1;
    let weight: number;
    if (typeof item.w === "string") {
      const m = /^issuerWeight\(([-0-9.]+)\)$/.exec(item.w);
      if (!m) throw new Error(`fixture: w desconocido ${item.w}`);
      weight = issuerWeight(Number(m[1]));
    } else if (typeof item.w === "number") {
      weight = item.w;
    } else {
      throw new Error("fixture: falta w");
    }
    const value = item.v;
    if (typeof value !== "number") throw new Error("fixture: falta v numerico");
    for (let i = 0; i < repeat; i++) out.push({ weight, value });
  }
  return out;
}

// --- executors -------------------------------------------------------------

type Executor = (
  c: Record<string, unknown>,
  push: (r: Omit<CaseResult, "vector" | "group">) => void
) => void | Promise<void>;

const execFingerprint: Executor = async (c, push) => {
  const actual = await jwkThumbprint(c.input as never);
  const expected = String(c.expect);
  const label = `#${c.n} ${c.desc ?? ""}`.trim();
  push(
    actual === expected
      ? { label, status: "pass" }
      : { label, status: "fail", detail: `esperado ${expected}, obtenido ${actual}` }
  );
};

const execJcs: Executor = (c, push) => {
  const expected = String(c.expect);
  let actual: string;
  try {
    actual = jcs(c.input as never);
  } catch (e) {
    push({ label: `#${c.n} ${c.desc ?? ""}`.trim(), status: "fail", detail: `lanzo: ${(e as Error).message}` });
    return;
  }
  push(
    actual === expected
      ? { label: `#${c.n} ${c.desc ?? ""}`.trim(), status: "pass" }
      : { label: `#${c.n} ${c.desc ?? ""}`.trim(), status: "fail", detail: `esperado ${expected}, obtenido ${actual}` }
  );
};

const execSha256: Executor = async (c, push) => {
  const repeat = c.inputUtf8Repeat as { char: string; count: number } | undefined;
  const input =
    typeof c.inputUtf8 === "string"
      ? c.inputUtf8
      : repeat
        ? repeat.char.repeat(repeat.count)
        : "";
  const actual = await sha256B64Url(input);
  const expected = String(c.expect);
  const label = `#${c.n} ${c.desc ?? ""}`.trim();
  push(
    actual === expected
      ? { label, status: "pass" }
      : { label, status: "fail", detail: `esperado ${expected}, obtenido ${actual}` }
  );
};

const execIssuerWeight: Executor = (c, push) => {
  const actual = issuerWeight(c.J as number);
  const tol = readNumber(c, "tolerance", 1e-12);
  push(
    near(actual, c.expect as number, tol)
      ? { label: `J=${c.J}`, status: "pass" }
      : { label: `J=${c.J}`, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
  );
};

const execJudgeFromDeviation: Executor = (c, push) => {
  const actual = judgeFromDeviation(c.d as number | null);
  push(
    near(actual, c.expect as number, EPS)
      ? { label: `d=${c.d === null ? "null" : c.d}`, status: "pass" }
      : { label: `d=${c.d === null ? "null" : c.d}`, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
  );
};

const execToValue: Executor = (c, push) => {
  const label = `scale=${c.scale} input=${JSON.stringify(c.input)}`;
  try {
    const actual = toValue(c.input as never, c.scale as never);
    push(
      near(actual, c.expect as number, EPS)
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo donde no debia: ${(e as Error).message}` });
  }
};

const execReaderConduct: Executor = (c, push) => {
  const label = `${c.cat} val=${c.val}`;
  try {
    const actual = readerConductToDimension(String(c.cat), c.val as boolean);
    const ok = actual.dimension === c.expectDimension && near(actual.value, c.expectValue as number, EPS);
    push(
      ok
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expectDimension}=${c.expectValue}, obtenido ${actual.dimension}=${actual.value}` }
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo donde no debia: ${(e as Error).message}` });
  }
};

const execReaderConductRejection: Executor = (c, push) => {
  const label = `categoria desconocida "${c.cat}"`;
  try {
    readerConductToDimension(String(c.cat), c.val as boolean);
    push({ label, status: "fail", detail: "no lanzo ante una categoria desconocida" });
  } catch {
    push({ label, status: "pass" });
  }
};

const execBayesian: Executor = (c, push) => {
  const label = `caso ${c.n}`;
  try {
    const items = expandItems(c.items as ReadonlyArray<Record<string, unknown>>);
    const actual = bayesianScore(items);
    const tol = readNumber(c, "tolerance", 1e-4);
    const problems: string[] = [];
    if (!near(actual.score, c.expectScore as number, tol)) {
      problems.push(`S esperado ${c.expectScore}, obtenido ${actual.score.toFixed(6)}`);
    }
    if (!near(actual.weightSum, c.expectWeightSum as number, tol)) {
      problems.push(`W esperado ${c.expectWeightSum}, obtenido ${actual.weightSum.toFixed(6)}`);
    }
    if (typeof c.expectCount === "number" && actual.count !== c.expectCount) {
      problems.push(`count esperado ${c.expectCount}, obtenido ${actual.count}`);
    }
    push(problems.length === 0 ? { label, status: "pass" } : { label, status: "fail", detail: problems.join("; ") });
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo: ${(e as Error).message}` });
  }
};

const execPeriodKey: Executor = (c, push) => {
  const label = `${c.date} period=${c.period}`;
  try {
    const actual = periodKey(new Date(String(c.date)), c.period as never);
    push(
      actual === c.expect
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo: ${(e as Error).message}` });
  }
};

const execDidKeyId: Executor = (c, push) => {
  const label = `sequence=${c.sequence}`;
  try {
    const actual = didKeyId(String(c.did), c.sequence as number);
    push(
      actual === c.expect
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo donde no debia: ${(e as Error).message}` });
  }
};

const execParseDidKeyId: Executor = (c, push) => {
  const label = `parse ${JSON.stringify(c.input)}`;
  const actual = parseDidKeyId(c.input);
  const expected = c.expect as { did: string; sequence: number };
  const ok = actual !== null && actual.did === expected.did && actual.sequence === expected.sequence;
  push(ok ? { label, status: "pass" } : { label, status: "fail", detail: `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}` });
};

const execParseDidKeyIdRejection: Executor = (c, push) => {
  const label = `rechaza ${JSON.stringify(c.input)}`;
  const actual = parseDidKeyId(c.input);
  push(actual === null ? { label, status: "pass" } : { label, status: "fail", detail: `no debia parsear: ${JSON.stringify(actual)}` });
};

const execManifestParse: Executor = (c, push) => {
  const label = `#${c.n} ${c.desc ?? ""}`.trim();
  const actual = parseApwManifest(String(c.raw));
  const expectValid = c.expectValid === true;
  if (expectValid && !actual.valid) {
    push({ label, status: "fail", detail: `esperaba valido, motivo ${actual.error}` });
    return;
  }
  if (!expectValid && c.expectError) {
    push(
      actual.valid || actual.error === c.expectError
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperaba ${c.expectError}, obtenido ${actual.error}` }
    );
    return;
  }
  if (expectValid && c.expectManifest) {
    const got = JSON.stringify(actual.manifest);
    const want = JSON.stringify(c.expectManifest);
    push(got === want ? { label, status: "pass" } : { label, status: "fail", detail: `esperado ${want}, obtenido ${got}` });
    return;
  }
  push({ label, status: "pass" });
};

const execManifestBuild: Executor = (c, push) => {
  const label = `#${c.n} ${c.desc ?? ""}`.trim();
  try {
    const manifest = buildApwManifest(c.input as never);
    const actual = serializeApwManifest(manifest);
    push(
      actual === c.expect
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo: ${(e as Error).message}` });
  }
};

// V-16 (Fase 9a): ranking determinista y hash del conjunto usado.
const asRankingEntries = (raw: ReadonlyArray<Record<string, unknown>>) =>
  raw.map((e) => ({
    subject: String(e.subject),
    issuer: String(e.issuer ?? e.subject),
    observedAt: e.observedAt as number,
    weight: e.weight as number,
    ...(typeof e.value === "number" ? { value: e.value } : {}),
    ...(typeof e.seq === "number" ? { seq: e.seq } : {}),
    ...(e.head !== undefined ? { head: e.head as string | null } : {}),
  }));

const execRanking: Executor = (c, push) => {
  const label = String(c.desc ?? "ranking");
  const q = (c.query ?? {}) as Record<string, unknown>;
  let result: ReturnType<typeof rankOrder>;
  try {
    result = rankOrder(
      {
        filter: q.filter as never,
        asOf: q.asOf as number,
        windowSeconds: q.windowSeconds as number | undefined,
        seq: q.seq as number | undefined,
        minWeight: q.minWeight as number | undefined,
      },
      asRankingEntries(c.entries as ReadonlyArray<Record<string, unknown>>)
    );
  } catch (e) {
    push({ label, status: "fail", detail: `lanzo: ${(e as Error).message}` });
    return;
  }
  const tol = readNumber(c, "tolerance", 1e-9);
  const problems: string[] = [];
  if (typeof c.expectAdmissible === "number" && result.admissible !== c.expectAdmissible) {
    problems.push(`admissible ${result.admissible} != ${c.expectAdmissible}`);
  }
  if (typeof c.expectExcluded === "number" && result.excludedWithoutObservation !== c.expectExcluded) {
    problems.push(`excluded ${result.excludedWithoutObservation} != ${c.expectExcluded}`);
  }
  if (Array.isArray(c.expectOrder)) {
    const want = c.expectOrder as Array<Record<string, unknown>>;
    if (want.length !== result.order.length) {
      problems.push(`order length ${result.order.length} != ${want.length} [${result.order.map((o) => o.subject).join(", ")}]`);
    } else {
      want.forEach((w, i) => {
        const g = result.order[i];
        if (String(w.subject) !== g.subject) problems.push(`#${i} subject ${g.subject} != ${w.subject}`);
        if (typeof w.score === "number" && !near(g.score, w.score, tol)) problems.push(`#${i} score ${g.score} != ${w.score}`);
        if (typeof w.weightSum === "number" && !near(g.weightSum, w.weightSum, tol)) problems.push(`#${i} weightSum ${g.weightSum} != ${w.weightSum}`);
        if (typeof w.count === "number" && g.count !== w.count) problems.push(`#${i} count ${g.count} != ${w.count}`);
        if (w.head !== undefined && (g.head ?? null) !== (w.head ?? null)) problems.push(`#${i} head ${g.head} != ${w.head}`);
      });
    }
  }
  push(problems.length ? { label, status: "fail", detail: problems.join("; ") } : { label, status: "pass" });
};

const execRankingHash: Executor = async (c, push) => {
  const label = String(c.desc ?? "rankingHash");
  const ha = await rankingInputHash(asRankingEntries(c.setA as ReadonlyArray<Record<string, unknown>>));
  const hb = await rankingInputHash(asRankingEntries(c.setB as ReadonlyArray<Record<string, unknown>>));
  const equal = ha === hb;
  push(equal === c.expectEqual ? { label, status: "pass" } : { label, status: "fail", detail: `equal=${equal} esperado ${c.expectEqual}` });
};

const EXECUTORS: Record<string, Executor> = {
  fingerprint: execFingerprint,
  ranking: execRanking,
  rankingHash: execRankingHash,
  jcs: execJcs,
  sha256b64url: execSha256,
  issuerWeight: execIssuerWeight,
  issuerWeightRatio: (c, push) => {
    const actual = issuerWeight(c.numerator as number) / issuerWeight(c.denominator as number);
    push(
      near(actual, c.expect as number, readNumber(c, "tolerance"))
        ? { label: `w(${c.numerator})/w(${c.denominator})`, status: "pass" }
        : { label: `w(${c.numerator})/w(${c.denominator})`, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  },
  judgeFromDeviation: execJudgeFromDeviation,
  toValue: execToValue,
  readerConductToDimension: execReaderConduct,
  readerConductRejection: execReaderConductRejection,
  bayesianScore: execBayesian,
  periodKey: execPeriodKey,
  didKeyId: execDidKeyId,
  parseDidKeyId: execParseDidKeyId,
  parseDidKeyIdRejection: execParseDidKeyIdRejection,
  manifestParse: execManifestParse,
  manifestBuild: execManifestBuild,
  selfWeight: (c, push) =>
    push(
      near(SELF_WEIGHT, c.expect as number, readNumber(c, "tolerance", 1e-12))
        ? { label: "SELF_WEIGHT", status: "pass" }
        : { label: "SELF_WEIGHT", status: "fail", detail: `esperado ${c.expect}, obtenido ${SELF_WEIGHT}` }
    ),

  // V-14 (ERRATA E-13): umbral de antiguedad del emisor comunitario.
  emitterAgeOk: (c, push) => {
    const label = String(c.desc ?? `iat=${c.iat}`);
    const minDays = typeof c.minDays === "number" ? c.minDays : undefined;
    const first = (c.firstSeenIat ?? c.emitterFirstSeenIat ?? undefined) as number | null | undefined;
    const actual = emitterAgeOk(c.iat as number, first, minDays);
    push(
      actual === c.expect
        ? { label, status: "pass" }
        : { label, status: "fail", detail: `esperado ${c.expect}, obtenido ${actual}` }
    );
  },

  // V-15 (ERRATA E-13): emisor distinto + min_weight sobre una categoria.
  communityPredicate: (c, push) => {
    const label = String(c.desc ?? "communityPredicate");
    const rows = (c.rows as Array<Record<string, unknown>>).map((r) => ({
      iss: String(r.iss),
      category: String(r.category),
      val: r.val as number,
      iat: r.iat as number,
      jti: String(r.jti),
      emitterFirstSeenIat: (r.emitterFirstSeenIat ?? undefined) as number | null | undefined,
    }));
    const judges = new Map<string, number>(
      Object.entries((c.judges as Record<string, number> | undefined) ?? {})
    );
    const minWeight = typeof c.minWeight === "number" ? c.minWeight : undefined;
    const result = communityPredicate(rows, judges, minWeight);

    const tol = readNumber(c, "tolerance", 1e-9);
    const problems: string[] = [];
    if (typeof c.expectEmitters === "number" && result.emitters !== c.expectEmitters) {
      problems.push(`emitters ${result.emitters} != ${c.expectEmitters}`);
    }
    if (typeof c.expectWeightSum === "number" && !near(result.weightSum, c.expectWeightSum, tol)) {
      problems.push(`weightSum ${result.weightSum} != ${c.expectWeightSum}`);
    }
    if (typeof c.expectPasses === "boolean" && result.passes !== c.expectPasses) {
      problems.push(`passes ${result.passes} != ${c.expectPasses}`);
    }
    if (Array.isArray(c.expectRows)) {
      const pick = (r: Record<string, unknown>) => ({ iss: String(r.iss), val: r.val as number, iat: r.iat as number });
      const byIss = (a: { iss: string }, b: { iss: string }) => (a.iss < b.iss ? -1 : a.iss > b.iss ? 1 : 0);
      const got = result.rows.map(pick).sort(byIss);
      const want = (c.expectRows as Array<Record<string, unknown>>).map(pick).sort(byIss);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(`rows ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      }
    }
    push(problems.length ? { label, status: "fail", detail: problems.join("; ") } : { label, status: "pass" });
  },
};

/**
 * Runs one vector file against the public surface.
 * `raw` is the parsed JSON of a file in `docs/protocol-apw/vectors/v1.3/`.
 */
export async function runVector(raw: Record<string, unknown>): Promise<VectorReport> {
  const vector = String(raw.id);
  const results: CaseResult[] = [];

  // Every fixture array is dispatched uniformly: each item carries its own
  // `kind`, so the runner never has to know which vector a file is.
  const groups: Array<[string, unknown]> = [
    ["cases", raw.cases],
    ["hashes", raw.hashes],
    ["build", raw.build],
    ["parse", raw.parse],
    ["emitterWeight", raw.emitterWeight],
    ["judgeFromDeviation", raw.judgeFromDeviation],
    ["valueMapping", raw.valueMapping],
    ["readerConductMapping", raw.readerConductMapping],
    ["parseRejections", raw.parseRejections],
  ];

  for (const [group, items] of groups) {
    if (!Array.isArray(items)) continue;
    for (const item of items as Record<string, unknown>[]) {
      const kind = String(item.kind ?? "");
      const exec = EXECUTORS[kind];
      if (!exec) {
        results.push({ vector, group, label: kind || "(sin kind)", status: "unsupported", detail: "sin executor para este kind" });
        continue;
      }
      await exec(item, (r) => results.push({ vector, group, ...r }));
    }
  }

  for (const key of ["ratio", "selfWeight", "readerConductRejection"] as const) {
    const single = raw[key];
    if (!single || typeof single !== "object") continue;
    const item = single as Record<string, unknown>;
    const exec = EXECUTORS[String(item.kind ?? "")];
    if (!exec) {
      results.push({ vector, group: key, label: String(item.kind ?? "(sin kind)"), status: "unsupported" });
      continue;
    }
    await exec(item, (r) => results.push({ vector, group: key, ...r }));
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const unsupported = results.filter((r) => r.status === "unsupported").length;

  return {
    vector,
    title: String(raw.title ?? ""),
    specSection: String(raw.specSection ?? ""),
    minimalInterop: raw.minimalInterop === true,
    total: results.length,
    passed,
    failed,
    unsupported,
    results,
  };
}

/**
 * Asserts that the constants the vectors rely on are part of the published
 * surface. If one is removed, a third-party implementation would have to guess
 * its value, so this is a conformance failure and not a test detail.
 */
export function checkSurfaceConstants(): string[] {
  const missing: string[] = [];
  const required = ["NEUTRAL", "PRIOR_WEIGHT", "SELF_WEIGHT"];
  for (const name of required) {
    if (!(name in apw)) missing.push(name);
  }
  if (apw.NEUTRAL !== 4.0) missing.push("NEUTRAL != 4.0");
  if (apw.PRIOR_WEIGHT !== 3) missing.push("PRIOR_WEIGHT != 3");
  return missing;
}

/** Human-readable one-line summary per vector. */
export function formatReport(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`APW conformance -- ${report.spec} vectors ${report.vectorsVersion}`);
  for (const v of report.vectors) {
    const flag = v.failed > 0 ? "FAIL" : v.unsupported > 0 ? "WARN" : "ok";
    lines.push(`  ${v.vector.padEnd(6)} ${flag}  ${v.passed}/${v.total}  ${v.title}`);
    for (const r of v.results) {
      if (r.status !== "pass") lines.push(`      ${r.status}: [${r.group}] ${r.label}${r.detail ? ` -- ${r.detail}` : ""}`);
    }
  }
  lines.push(
    `total ${report.passed}/${report.total} passed, ${report.failed} failed, ${report.unsupported} unsupported`
  );
  lines.push(
    `minimal interoperability set (${report.minimalInteropRequired.join(", ")}): ${
      report.minimalInteropSatisfied ? "satisfied" : "NOT satisfied"
    }`
  );
  return lines.join("\n");
}