import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const text = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const registry = 'LTP-GATES-AND-AUTHORIZATIONS.md';
const dependents = ['LTP-STANDARDIZATION-STATUS.md', 'LTP-S3-COVERAGE.md', 'LTP-S3-CORE-CLOSURE-PLAN.md',
  'LTP-APPROVAL-RECORD.md', 'LTP-SERIALIZATION-DRAFT-v0.1.md', 'LTP-STACK-ARCHITECTURE.md', 'LTP-ARTIFACT-CLASSIFICATION.md',
  'LTP-G2-G3-IMPLEMENTATION-SCOPE.md'];

test('there are exactly five canonical authorization gates: G1 accepted, G2/G3 bounded, G4/G5 blocked', () => {
  const rows = text(registry).split('\n').filter(line => /^\| \*\*G[1-5]\*\* \|/.test(line));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(line => line.match(/\*\*(G[1-5])\*\*/)[1]), ['G1', 'G2', 'G3', 'G4', 'G5']);
  assert(rows[0].includes('**ACCEPTED**'));
  assert(rows[1].includes('**AUTHORIZED**'));
  assert(rows[2].includes('**AUTHORIZED**'));
  assert(rows[3].includes('**BLOCKED**'));
  assert(rows[4].includes('**BLOCKED**'));
  assert.match(text(registry), /Recorded owner decision — 2026-10-24/);
  assert.match(text(registry), /G2 and G3 do not open G4 or G5/);
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
  assert.match(text(registry), /live-egress\/SSRF addendum/);
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
