import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const audit = 'docs/protocol-apw/vectors/ltp/v0.1/tools/audit.mjs';

test('S1/S3 frozen assets pass schema, native crypto and rational cross-checks (same author)', () => {
  const result = spawnSync(process.execPath, [audit], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ resolutionCases: 37, ed25519Signatures: 8, dnssecSignatures: 12,
    svriMathCases: 13, canonicalByteCases: 8, invalidJsonTargets: 7, productionEngineTested: false });
});

test('signed numeric profile rejects fractions rather than silently changing signed bytes', () => {
  const result = spawnSync(process.execPath, [audit, '--signed-float-for-test'], { cwd: root, encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('signed payload numbers must be safe integers');
});

test('Python and Node agree on numeric serialization; every existing signed payload has no float token', () => {
  const python = spawnSync(process.env.LTP_PYTHON || 'python3', [
    'docs/protocol-apw/vectors/ltp/v0.1/tools/numeric-audit.py',
  ], { cwd: root, encoding: 'utf8' });
  expect(python.status, python.stderr).toBe(0);
  expect(JSON.parse(python.stdout)).toMatchObject({ numericCases: 12, signedFloatTokens: 0, discrepancies: [] });
});

test('the audit rejects tampered fixture content instead of rewriting its expected commitment', () => {
  const result = spawnSync(process.execPath, [audit, '--corrupt-in-memory-for-test'], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('frozen fixture digest: changed-key-window.json');
});
