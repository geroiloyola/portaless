import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const audit = 'docs/protocol-apw/tools/core-audit.mjs';
test('the total S3-core candidate pins initial and new static assets, signatures, schemas and six case areas', () => {
  const result = spawnSync(process.execPath, [audit], { encoding: 'utf8', timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ candidateDigest: 'wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg',
    coreCases: 285, pinnedAssets: 51, originalSignatures: 2064, invalidSignatures: 2,
    areas: { 'CORE-01': 14, 'CORE-02': 42, 'CORE-03': 23, 'CORE-04': 46, 'CORE-05': 39, 'CORE-06': 121 },
    serviceReasonClasses: 14, rawParserTargets: 9, longChainEntries: 1000,
    semanticExpectedVerdictsExecuted: false, productionEngineTested: false, networkConnections: 0 });
});

test('changing a frozen core expectation is rejected instead of recomputing its golden commitment', () => {
  const result = spawnSync(process.execPath, [audit, '--tamper-for-test'], { encoding: 'utf8', timeout: 20_000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('frozen candidate asset: core-01-bootstrap.json');
});
