import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('the locked MCP/Express parser survives trailing compressed bytes and serves a subsequent request', () => {
  const fixture = fileURLToPath(new URL('../fixtures/body-parser-compression.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [fixture], { encoding: 'utf8', timeout: 10_000 });
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ deflate: 200, gzip: 200, health: 200 });
});
