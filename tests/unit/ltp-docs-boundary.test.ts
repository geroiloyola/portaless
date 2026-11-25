import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('specification link boundary (@verared/spec)', () => {
  test('pinned @verared/spec passes docs-boundary check with zero runtime links', () => {
    const result = spawnSync(
      process.execPath,
      ['node_modules/@verared/spec/spec/tools/docs-boundary.mjs'],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  test('local docs/protocol-apw/ contains only the canonical redirect README.md', () => {
    const entries = readdirSync('docs/protocol-apw').sort();
    expect(entries).toEqual(['README.md']);
  });
});
