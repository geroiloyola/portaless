import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('S3 scanner exceptions name only exact committed public fixture findings, not broad paths or real credentials', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const prefix = 'docs/protocol-apw/vectors/ltp/v0.1/';
  const manifest = JSON.parse(read(`${prefix}manifest.json`));
  const names = new Set(manifest.fixtures.map((entry: { file: string }) => entry.file));
  const ledger = read('.gitleaksignore').split('\n');
  const entries = ledger.filter(line => /^[a-f0-9]{40}:docs\/protocol-apw\/vectors\/ltp\/v0.1\//.test(line));
  expect(entries).toHaveLength(28);
  expect(new Set(entries).size).toBe(entries.length);
  for (const entry of entries) {
    const [commit, path, rule, number] = entry.split(':');
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(ledger[ledger.indexOf(entry) - 1]).toContain('solo pruebas');
    expect(path.startsWith(prefix)).toBe(true);
    expect(names.has(path.slice(prefix.length))).toBe(true);
    const line = read(path).split('\n')[Number(number) - 1];
    expect(line).toBeDefined();
    if (rule === 'jwt') {
      const compacts = line.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
      expect(compacts.length).toBeGreaterThan(0);
      for (const compact of compacts) {
        const header = JSON.parse(Buffer.from(compact.split('.')[0], 'base64url').toString());
        expect(header.alg).toBe('EdDSA');
        expect(header.typ).toMatch(/^apw-(manifest|log|attestation|key-set)\+jws$/);
        expect(['did:apw:vector.example#key-1', 'escrow-test-key-1']).toContain(header.kid);
      }
    } else {
      expect(rule).toBe('generic-api-key');
      expect(line).toMatch(/"(?:keySetDigest|dnskeyRdata|zoneDnskeyRdata)"\s*:\s*"/);
    }
  }
});

test('solo-pruebas keys, seeds and scanner values are confined to fixture tooling, never tracked production source', () => {
  const prefix = 'docs/protocol-apw/vectors/ltp/v0.1/';
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const values = new Set<string>();
  function collect(value: unknown, key = '') {
    if (typeof value === 'string') {
      if (['x', 'y', 'n', 'site', 'issuer', 'dnskeyRdata', 'zoneDnskeyRdata', 'keySetDigest', 'keyId', 'kid'].includes(key)
        && value.length >= 16) values.add(value);
      if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) values.add(value);
    } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collect(v, k);
  }
  const manifest = JSON.parse(read(`${prefix}manifest.json`));
  for (const { file } of manifest.fixtures) collect(JSON.parse(read(prefix + file)));
  expect(values.size).toBeGreaterThan(20);
  const leaks = (source: string) => [...values].filter(value => source.includes(value));
  // Prove the check detects deliberate literal reuse rather than testing an empty set.
  const probe = [...values][0];
  expect(leaks(`const productionIdentity = ${JSON.stringify(probe)}`)).toContain(probe);
  const tracked = spawnSync('git', ['ls-files', '-z', '--', 'functions', 'packages', 'src', 'server', 'scripts'], { encoding: 'utf8' });
  expect(tracked.status, tracked.stderr).toBe(0);
  const sources = tracked.stdout.split('\0').filter(path => /\.(?:ts|js|mjs|json|sql)$/.test(path)
    && !/(?:^|\/)(?:tests|__tests__|fixtures|node_modules|dist)\//.test(path)
    && !/\.(?:test|spec)\./.test(path));
  expect(sources.length).toBeGreaterThan(100);
  for (const path of sources) expect(leaks(read(path)), `test material reused in ${path}`).toEqual([]);
});
