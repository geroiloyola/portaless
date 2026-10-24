import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const text = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const scopeText = path => text(path);
const registry = 'LTP-GATES-AND-AUTHORIZATIONS.md';
const dependents = ['LTP-STANDARDIZATION-STATUS.md', 'LTP-S3-COVERAGE.md', 'LTP-S3-CORE-CLOSURE-PLAN.md',
  'LTP-APPROVAL-RECORD.md', 'LTP-SERIALIZATION-DRAFT-v0.1.md', 'LTP-STACK-ARCHITECTURE.md', 'LTP-ARTIFACT-CLASSIFICATION.md',
  'LTP-G2-G3-IMPLEMENTATION-SCOPE.md', 'LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md'];
const runtimeProposal = () => readFileSync(new URL('../../architecture/ltp-runtime-integration-proposal.md', import.meta.url), 'utf8');

test('there are exactly five canonical authorization gates: G1–G3 accepted, G4/G5 pending explicit authorization', () => {
  const rows = text(registry).split('\n').filter(line => /^\| \*\*G[1-5]\*\* \|/.test(line));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(line => line.match(/\*\*(G[1-5])\*\*/)[1]), ['G1', 'G2', 'G3', 'G4', 'G5']);
  assert(rows[0].includes('**ACCEPTED**'));
  assert(rows[1].includes('**ACCEPTED**'));
  assert(rows[2].includes('**ACCEPTED**'));
  assert(rows[3].includes('**PENDING_AUTHORIZATION**'));
  assert(rows[4].includes('**PENDING_AUTHORIZATION**'));
  assert.match(text(registry), /Recorded owner decision — 2026-10-24/);
  assert.match(text(registry), /G2 and G3 are accepted for the bounded implementation/);
  assert.match(text(registry), /G4 and G5 remain pending/);
  assert.match(scopeText(registry), /Cloudflare Workers are not covered/);
  for (const file of dependents) {
    const value = text(file);
    assert(value.includes(registry), `canonical reference required in ${file}`);
    assert(!/^\| \*\*G[1-5]\*\* \|/m.test(value), `duplicate authorization table in ${file}`);
    assert(!/After merge and owner approval[\s\S]{0,100}next phase/i.test(value), `implicit implementation transition in ${file}`);
    assert(!/approves[\s\S]{0,90}and authorizes that next phase/i.test(value), `combined corpus/implementation decision in ${file}`);
  }
});

test('the bounded G2/G3 scope names the corpus, prohibitions and acceptance evidence', () => {
  const scope = text('LTP-G2-G3-IMPLEMENTATION-SCOPE.md');
  assert.match(scope, /wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA/);
  assert.match(scope, /AB-STATIC-01…07/);
  assert.match(scope, /G4/);
  assert.match(scope, /G5/);
  assert.match(scope, /Not permitted by G2:[^\n]*redirect/i);
  assert.match(scope, /Not permitted by G3:[^\n]*reputation/i);
  assert.match(scope, /S4 remains open/);
  assert.match(scope, /hardening addendum/);
  assert.match(scope, /pin the verified address/);
  assert.match(scope, /Cloudflare Workers[\s\S]{0,200}not covered/);
  assert.match(scope, /Written consent from the operator/);
  assert.match(scope, /not executed in CI/);
  assert.match(text(registry), /live-egress\/SSRF addendum/);
});

test('G4 pre-review and runtime integration proposal are reports, not authorizations', () => {
  const g4 = text('LTP-G4-REPUTATION-PREAUTHORIZATION-REVIEW.md');
  assert.match(g4, /G4 is not authorized/);
  assert.match(g4, /binary64/);
  assert.match(g4, /1e-9/);
  assert.match(g4, /denominator/);
  assert.match(g4, /Differential tests required/);
  assert.match(g4, /apw-resolver/);
  const runtime = runtimeProposal();
  assert.match(runtime, /proposal only/);
  assert.match(runtime, /grant_missing/);
  assert.match(runtime, /B3/);
  assert.match(runtime, /Migration:/);
  assert.match(runtime, /Cloudflare Workers|Workers/);
});

test('reputation and offline DNSSEC scopes remain separated and S4/S6 evidence independent', () => {
  const matrix = text('LTP-S3-COVERAGE.md');
  const reputationRows = matrix.slice(matrix.indexOf('## S3-reputation'), matrix.indexOf('## Recorded S3-core'));
  assert(!/^\| Advanced DNSSEC \|/m.test(reputationRows));
  assert.match(matrix, /distinct scope under \*\*G5\*\*/);
  const status = text('LTP-STANDARDIZATION-STATUS.md');
  assert.match(status, /\| S4 \| Obtain agreement from at least two independent verifiers/);
  assert.match(status, /\| S6 \| Publish a versioned normative release after S1–S5/);
  assert.match(text(registry), /S4 still requires/);
  assert.match(text(registry), /S6 still/);
});
