import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('protocol documentation has no implementation links outside a marked reference appendix', () => {
  const result = spawnSync(process.execPath, ['docs/protocol-apw/tools/docs-boundary.mjs'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});
