import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { violations, checkTree } from './docs-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('specification links cannot depend on runtime outside an explicit reference appendix', () => {
  assert.deepEqual(checkTree(root), []);
  assert.deepEqual(violations('[runtime](../../../packages/core/x.ts)\n[ref]: ../../functions/x.js\n<a href="/src/x.ts">x</a>'), [1, 2, 3]);
  assert.deepEqual(violations('[encoded](../../%70ackages/x)\n<https://github.com/example/repo/blob/main/functions/x>'), [1, 2]);
  assert.deepEqual(violations('## Apéndice: implementación de referencia\n[x](../../src/x.ts)\n## Normative again\n[x](../../src/x.ts)'), [4]);
});

test('asset package declares only standalone tooling, with no Portaless imports', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['ajv', 'canonicalize', 'jose']);
  assert.equal(pkg.dependencies, undefined);
  for (const dir of ['tools', 'vectors/ltp/v0.1/tools']) for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (!/\.(mjs|py)$/.test(file)) continue;
    const text = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8');
    assert(!/(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:packages|functions|src)\//.test(text), file);
  }
});

test('third-party OpenSSL/JOSE/dnspython agree on original signatures and reject mutations', () => {
  const result = spawnSync(process.execPath, ['vectors/ltp/v0.1/tools/external-audit.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.joseChecks, 8);
  assert.equal(report.opensslChecks, 20);
  assert.equal(report.mutationsRejected, 28);
  assert.equal(report.dns.rrsigs, 12);
  assert.equal(report.dns.boundaryChecks, 48);
  assert.deepEqual(report.discrepancies, []);
  assert.deepEqual(report.dns.discrepancies, []);
  assert.equal(report.independentReviewer, false);
  assert.equal(report.primitiveBackendFamily, 'OpenSSL');
  assert.equal(report.independentPrimitiveBackends, false);
  assert.match(report.nodeOpenSSL, /^\d+\./);
  assert.match(report.dns.primitiveBackend, /^OpenSSL /);
});
