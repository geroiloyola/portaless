// CC BY 4.0. Read-only candidate/record check; never grants approval or writes files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import canonicalize from 'canonicalize';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const hash = (bytes, encoding) => createHash('sha256').update(bytes).digest(encoding);
const jcsDigest = path => hash(Buffer.from(canonicalize(JSON.parse(read(path)))), 'base64url');
export const normativePaths = [
  'LTP-SERIALIZATION-DRAFT-v0.1.md', 'APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md',
  'LTP-STACK-ARCHITECTURE.md', 'LTP-ARTIFACT-CLASSIFICATION.md',
  'LTP-INDEX-DRAFT-v0.1.md', 'LTP-PROOF-PACKAGE-DRAFT-v0.1.md',
  'LTP-STANDARDIZATION-STATUS.md', 'LTP-S3-COVERAGE.md',
  'vectors/ltp/v0.1/README.md', 'LTP-CI-REVIEW.md',
  'APW-SPEC-v1.3.md', 'SVRI-v1.0.md', 'README.md', 'LTP-S3-CORE-CLOSURE-PLAN.md',
  'vectors/ltp/v0.2/README.md',
  'LTP-GATES-AND-AUTHORIZATIONS.md', 'vectors/ltp/v0.3/README.md',
  'LTP-G2-G3-IMPLEMENTATION-SCOPE.md',
];
const decisionKeys = ['corpusDigest', 'decidedAt', 'decision', 'mergeCommit', 'reviewedCommit', 'reviewer', 'scope'];

/** Validates the recorded G1 decision against the actual candidate digest. */
export function validateOwnerDecision(decision, corpusDigest) {
  if (decision === null) return null;
  assert.deepEqual(Object.keys(decision).sort(), decisionKeys, 'owner decision fields');
  assert.equal(decision.decision, 'approved');
  assert.equal(decision.scope, 'G1-static-corpus-only');
  assert.match(decision.decidedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(decision.reviewedCommit, /^[a-f0-9]{40}$/);
  assert.match(decision.mergeCommit, /^[a-f0-9]{40}$/);
  assert.equal(decision.reviewer, 'linstarkcorp');
  assert.equal(decision.corpusDigest, corpusDigest);
  return decision;
}

export function candidate(normativeCommit, ownerDecision = null) {
  assert.match(normativeCommit, /^[a-f0-9]{40}$/);
  return {
    status: ownerDecision ? 'approved' : 'pending-owner-decision',
    ownerDecision,
    decisionScope: 'G1-static-corpus-only',
    normativeCommit,
    corpusVersion: '0.3',
    schemaBundleDigest: jcsDigest('schemas/v0.1/manifest.json'),
    originalCorpusDigest: jcsDigest('vectors/ltp/v0.1/manifest.json'),
    previousCorpusDigest: jcsDigest('vectors/ltp/v0.2/manifest.json'),
    corpusDigest: jcsDigest('vectors/ltp/v0.3/manifest.json'),
    numericExtensionDigest: jcsDigest('vectors/ltp/v0.1/numeric-serialization.json'),
    normativeFiles: Object.fromEntries(normativePaths.map(path => [path, hash(read(path), 'hex')])),
  };
}
export function readRecord() {
  const match = read('LTP-APPROVAL-RECORD.md').toString().match(/```json\n([\s\S]*?)\n```/);
  assert(match, 'approval record must contain an explicit JSON candidate tuple');
  return JSON.parse(match[1]);
}
export function checkRecord(record, readProse = read) {
  assert.deepEqual(Object.keys(record.normativeFiles), normativePaths, 'required normative prose scope');
  const actual = candidate(record.normativeCommit);
  const decision = validateOwnerDecision(record.ownerDecision, actual.corpusDigest);
  const expected = candidate(record.normativeCommit, decision);
  assert.deepEqual(record, expected, 'data digests, exact prose bytes and recorded decision must match');
  for (const path of normativePaths) assert.equal(hash(readProse(path), 'hex'), record.normativeFiles[path], `changed normative prose: ${path}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--candidate') {
    const decision = process.argv[4] ? JSON.parse(process.argv[4]) : null;
    console.log(JSON.stringify(candidate(process.argv[3], decision), null, 2));
  } else {
    const record = readRecord();
    checkRecord(record);
    console.log(record.ownerDecision
      ? 'Recorded G1 owner decision matches the corpus, exact prose and data digests; G2/G3 remain separate register decisions.'
      : 'Candidate tuple matches data digests and exact normative prose; owner approval remains pending.');
  }
}
