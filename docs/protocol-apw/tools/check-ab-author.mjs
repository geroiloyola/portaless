// Read-only assembly comparison; never executes the recorded A/B trace.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.env.LTP_PYTHON || 'python3', [fileURLToPath(new URL('ab-author.py', import.meta.url)), '--check'], { encoding: 'utf8', timeout: 60_000 });
assert.equal(result.status, 0, result.stderr);
process.stdout.write(result.stdout);
