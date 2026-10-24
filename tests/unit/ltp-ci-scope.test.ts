import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
test('all standalone checks fail the already-required unit job without a separate cross-check context or coverage relaxation', () => {
  const note = read('docs/protocol-apw/LTP-CI-REVIEW.md');
  const unit = read('.github/workflows/unit-tests.yml');
  expect(existsSync(new URL('../../.github/workflows/ltp-assets.yml', import.meta.url))).toBe(false);
  expect(unit).toContain('LTP static cross-check (required unit job)');
  expect(unit).toContain('python -m pip install -r docs/protocol-apw/requirements-audit.txt');
  expect(unit).toContain('npm run check:author && npm run check:numbers && npm run audit && npm run check:core && npm run audit:core && npm run check:ab && npm run audit:ab && npm test');
  expect(unit).not.toContain('continue-on-error:');
  expect(read('.github/workflows/full-tests.yml')).toContain('--coverage.thresholds.lines=68');
  expect(note).toContain('Unit Tests / unit');
  expect(read('tests/unit/ltp-docs-boundary.test.ts')).toContain('docs/protocol-apw/tools/docs-boundary.mjs');
  for (const [workflow, command] of [['unit-tests.yml', 'vitest run tests/unit/'],
    ['full-tests.yml', 'vitest run'], ['ci.yml', 'npm test']]) {
    expect(read(`.github/workflows/${workflow}`)).toContain(command);
  }
  expect(note).toContain('`vitest tests/unit (Node 24)`');
  expect(note).toContain('`Todos los tests + cobertura (Node 24)`');
});
