// Local in-process admission overhead only. No requests go to third-party hosts.
// Run: node --import tsx scripts/measure-resolution-admission.mjs
import { ResolutionBudget, RESOLUTION_BUDGET_PROPOSAL } from "../packages/trust-layer/src/net/resolution-budget.ts";

const rows = [];
for (const maxBuckets of [128, 1024, 4096]) {
  const budget = new ResolutionBudget({ ...RESOLUTION_BUDGET_PROPOSAL, maxBuckets }, () => 0);
  let started = 0;
  const fetcher = async () => { started++; return { ok: true, text: "ok" }; };
  let id = 0;
  const admit = async () => {
    const i = id++;
    const result = await budget.fetch({ clientBucket: i.toString(16).padStart(64, "0"), directoryOrigin: `https://churn-${i}.example`, stage: "directory" },
      "https://controlled.example/", fetcher, { maxBytes: 10 });
    if (!result.ok) throw new Error("measurement_admission_rejected");
  };
  for (let i = 0; i < maxBuckets / 2 + 2000; i++) await admit();
  const samples = [];
  for (let i = 0; i < 6000; i++) {
    const start = performance.now();
    await admit();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const quantile = (p) => Number(samples[Math.floor((samples.length - 1) * p)].toFixed(6));
  const state = budget.stateForTests();
  rows.push({ maxBuckets, retained: state.buckets.length, active: state.activeTotal, started,
    samples: samples.length, p50_ms: quantile(.5), p95_ms: quantile(.95), p99_ms: quantile(.99) });
}
console.log(JSON.stringify({ node: process.version, transport: "synthetic resolved fetcher; no DNS/TLS/network", rows }, null, 2));
