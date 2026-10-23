import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
test('CI scope note distinguishes the standalone job from required root lint jobs and leaves moving checks a proposal', () => {
  const note = read('docs/protocol-apw/LTP-CI-REVIEW.md');
  const standalone = read('.github/workflows/ltp-assets.yml');
  expect(standalone).toContain('  cross-check:');
  expect(standalone).toContain('npm run check:author && npm run check:numbers && npm run audit && npm test');
  expect(note).toContain('**No.** It reports on PRs');
  expect(note).toContain('**Not executed in this revision.**');
  expect(read('tests/unit/ltp-docs-boundary.test.ts')).toContain('docs/protocol-apw/tools/docs-boundary.mjs');
  for (const [workflow, command] of [['unit-tests.yml', 'vitest run tests/unit/'],
    ['full-tests.yml', 'vitest run'], ['ci.yml', 'npm test']]) {
    expect(read(`.github/workflows/${workflow}`)).toContain(command);
  }
  expect(note).toContain('`vitest tests/unit (Node 24)`');
  expect(note).toContain('`Todos los tests + cobertura (Node 24)`');
});
