import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const text = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const json = name => JSON.parse(text(name));

test('Draft typ registry covers every S1 envelope without relabeling deployed apw-index', () => {
  const architecture = text('LTP-STACK-ARCHITECTURE.md');
  for (const name of ['ltp-proof-package', 'ltp-resolution-request', 'ltp-resolution-result']) {
    const schema = json(`schemas/v0.1/${name}.schema.json`);
    assert(architecture.includes(`| \`${schema.properties.typ.const}\` |`));
  }
  assert.match(architecture, /apw-index.*historical witness directory/);
  for (const role of ['Issuer', 'Verifier', 'Relay / Index', 'Consumer']) assert(architecture.includes(`| ${role} |`));
});

test('grant-only classification covers all artifacts and preserves identity-only non-scoring schema', () => {
  const classification = text('LTP-ARTIFACT-CLASSIFICATION.md');
  const rows = classification.split('\n').filter(line => /^\| (?!Artifact|---)/.test(line));
  assert.equal(rows.length, 7);
  for (const row of rows) assert.match(row, /\*\*\([abc]\)\*\*/);
  const schema = json('schemas/v0.1/ltp-proof-package.schema.json');
  const identity = schema.allOf.find(rule => rule.if.properties.profile.const === 'apw-identity-proof-v1');
  assert.equal(identity.then.properties.attestations.maxItems, 0);
  assert.equal(schema.allOf[0].else.properties.calculation.type, 'null');
  assert.match(classification, /A and B can advance without standardizing the Index/);
  assert.match(classification, /still precedes PR3/);
});

test('DNSSEC scope cannot mistake RRset primitive checks for an offline chain validator', () => {
  const bootstrap = text('APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md');
  for (const topic of ['DS delegation-chain', 'NSEC/NSEC3', 'wildcard', 'algorithm rotation/rollover']) assert(bootstrap.includes(topic));
  assert.match(bootstrap, /not-yet-supported conformance target/);
  assert.match(bootstrap, /Do not implement a custom\nproduction DNSSEC validator/);
  assert.match(text('vectors/ltp/v0.1/tools/dnspython-audit.py'), /"delegationChainValidated": False/);
});

test('S3 coverage is a blocking approval gate, not waived by primitive-check success or baseline merge', () => {
  const coverage = text('vectors/ltp/v0.1/README.md');
  assert.match(coverage, /BLOCKING — corpus approval is not available/);
  const matrix = text('LTP-S3-COVERAGE.md');
  for (const topic of ['reader_conduct', 'Rotations/multiple-key ordering', '(iss,jti)', 'Community calibration']) assert(matrix.includes(topic));
  const serviceCases = json('vectors/ltp/v0.2/core-05-errors.json').cases.filter(c => c.expected.stage === 'service');
  const reasons = json('schemas/v0.1/ltp-resolution-result.schema.json').properties.reason.enum.filter(x => x !== null);
  assert.deepEqual([...new Set(serviceCases.map(c => c.expected.reason).filter(Boolean))].sort(), reasons.sort());
  const candidate = json('vectors/ltp/v0.2/coverage.json');
  assert.equal(candidate.areas.length, 6);
  assert(candidate.areas.every(area => area.cases.length > 0));
  assert.match(matrix, /G1 accepted 2026-10-24/);
  assert.match(matrix, /G2\/G3 implementation authorized/);
  assert.match(matrix, /LTP-GATES-AND-AUTHORIZATIONS.md/);
  assert.match(text('LTP-STANDARDIZATION-STATUS.md'), /S1\/S3-core were accepted under G1 on\n2026-10-24/);
});

test('future signed SVRI and HSVR cannot silently inherit unsigned binary64 projection encoding', () => {
  const serialization = text('LTP-SERIALIZATION-DRAFT-v0.1.md');
  assert.match(serialization, /Any future signed SVRI\/HSVR MUST use rational or string encoding, never\nfloating-point JSON numbers/);
  const numbers = json('vectors/ltp/v0.1/numeric-serialization.json').cases;
  assert(numbers.some(c => c.wire.includes('numerator') && c.signedInteger));
  assert(numbers.some(c => c.wire === '1.25' && !c.signedInteger));
});

test('v0.1 single-key baseline is preserved while v0.2 adds three-key rotation targets without claiming implementation', () => {
  const base = json('vectors/ltp/v0.1/valid-proof-chain.json');
  assert.equal(base.result.package.histories[0].keys.length, 1);
  const matrix = text('LTP-S3-COVERAGE.md');
  assert.match(matrix, /initial v0.1 positive chain uses one key only/);
  assert.equal(json('vectors/ltp/v0.2/proofs.json').proofs['identity-rotation'].result.package.histories[0].keys.length, 3);
  assert.match(matrix, /distinct scope under \*\*G5\*\*/);
  assert.match(matrix, /not an implementation/);
});

test('S3-core closure requires all six A/B evidence packages and separates corpus approval from runtime acceptance', () => {
  const plan = text('LTP-S3-CORE-CLOSURE-PLAN.md');
  const rows = plan.split('\n').filter(line => /^\| CORE-0[1-6] \|/.test(line));
  assert.equal(rows.length, 6);
  for (const id of ['01', '02', '03', '04', '05', '06']) assert(rows.some(row => row.startsWith(`| CORE-${id} |`)));
  assert.match(plan, /Any missing prerequisite keeps both\n   deliveries blocked/);
  assert.match(plan, /sole authorization\s+definitions\/states/);
  assert.match(plan, /authorized static revision publishes the new total-corpus digest/);
  assert.match(plan, /No transition to it\s+follows from corpus approval or merge/);
});
