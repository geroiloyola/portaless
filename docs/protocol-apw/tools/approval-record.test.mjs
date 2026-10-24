import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkRecord, readRecord } from './approval-record.mjs';

test('approval tuple binds candidate commitments and exact normative prose; a text edit cannot retain that tuple', () => {
  const record = readRecord();
  checkRecord(record);
  assert.equal(record.ownerDecision, null);
  assert.equal(record.decisionScope, 'G1-static-corpus-only');
  assert.match(record.normativeCommit, /^[a-f0-9]{40}$/);
  const changed = structuredClone(record); changed.corpusDigest = record.numericExtensionDigest;
  assert.throws(() => checkRecord(changed), /data digests/);
  assert.throws(() => checkRecord(record, path => {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    return path === 'LTP-SERIALIZATION-DRAFT-v0.1.md' ? Buffer.concat([bytes, Buffer.from('\nchanged rule')]) : bytes;
  }), /changed normative prose/);
});
