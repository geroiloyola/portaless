import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkRecord, readRecord } from './approval-record.mjs';

test('approval tuple binds candidate commitments and exact normative prose; a text edit cannot retain that tuple', () => {
  const record = readRecord();
  checkRecord(record);
  assert.equal(record.status, 'approved');
  assert.equal(record.decisionScope, 'G1-static-corpus-only');
  assert.equal(record.ownerDecision.decision, 'approved');
  assert.equal(record.ownerDecision.scope, 'G1-static-corpus-only');
  assert.equal(record.ownerDecision.reviewer, 'linstarkcorp');
  assert.equal(record.ownerDecision.corpusDigest, record.corpusDigest);
  assert.equal(record.ownerDecision.reviewedCommit, '3ff080b42481e9321b449cec6e4e78ae5a9c9653');
  assert.equal(record.ownerDecision.mergeCommit, '7fd939fda0e2570e5c18dfbe0e555483b52b449f');
  assert.match(record.normativeCommit, /^[a-f0-9]{40}$/);
  const changed = structuredClone(record); changed.corpusDigest = record.numericExtensionDigest;
  assert.throws(() => checkRecord(changed), /data digests/);
  const forged = structuredClone(record); forged.ownerDecision.scope = 'G1-and-G3';
  assert.throws(() => checkRecord(forged), /scope/);
  const forgedDigest = structuredClone(record); forgedDigest.ownerDecision.corpusDigest = record.numericExtensionDigest;
  assert.throws(() => checkRecord(forgedDigest), /corpus digest|expected/);
  assert.throws(() => checkRecord(record, path => {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    return path === 'LTP-SERIALIZATION-DRAFT-v0.1.md' ? Buffer.concat([bytes, Buffer.from('\nchanged rule')]) : bytes;
  }), /changed normative prose/);
});
