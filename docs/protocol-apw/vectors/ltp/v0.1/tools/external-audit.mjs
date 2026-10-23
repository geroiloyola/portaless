// CC BY 4.0. Same-author orchestration of tools written by third parties.
// No network, no LTP engine and no claim of independent human review.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactVerify, importJWK } from 'jose';

const root = new URL('../', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const decode = text => Buffer.from(text, 'base64url');
const pointer = (v, path) => path.slice(1).split('/').reduce((o, k) => o[k], v);
const temporary = mkdtempSync(join(tmpdir(), 'ltp-primitive-audit-'));
let joseChecks = 0, opensslChecks = 0, mutationsRejected = 0;
const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
function openssl(jwk, message, signature, algorithm) {
  writeFileSync(join(temporary, 'key.pem'), createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(temporary, 'message'), message);
  // DNSSEC P-256 is fixed-width r||s; OpenSSL dgst consumes ASN.1 DER.
  if (algorithm === 13) {
    const integer = bytes => {
      while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
      if (bytes[0] & 128) bytes = Buffer.concat([Buffer.from([0]), bytes]);
      return Buffer.concat([Buffer.from([2, bytes.length]), bytes]);
    };
    const pair = Buffer.concat([integer(signature.subarray(0, 32)), integer(signature.subarray(32))]);
    signature = Buffer.concat([Buffer.from([0x30, pair.length]), pair]);
  }
  writeFileSync(join(temporary, 'signature'), signature);
  const args = algorithm === 15
    ? ['pkeyutl', '-verify', '-rawin', '-pubin', '-inkey', join(temporary, 'key.pem'), '-sigfile', join(temporary, 'signature'), '-in', join(temporary, 'message')]
    : ['dgst', '-sha256', '-verify', join(temporary, 'key.pem'), '-signature', join(temporary, 'signature'), join(temporary, 'message')];
  const result = run(process.env.LTP_OPENSSL || 'openssl', args);
  assert(!result.error, String(result.error));
  return result.status === 0;
}
try {
  for (const item of json('crypto-ledger.json').jws) {
    const compact = pointer(json(item.ref.file), item.ref.pointer);
    const [header, payload, sig] = compact.split('.');
    const key = await importJWK(item.publicKeyJwk, 'EdDSA');
    const verified = await compactVerify(compact, key, { algorithms: ['EdDSA'] });
    assert.deepEqual(Buffer.from(verified.payload), decode(payload));
    joseChecks++;
    const bad = Buffer.from(decode(sig)); bad[0] ^= 1;
    await assert.rejects(compactVerify(`${header}.${payload}.${bad.toString('base64url')}`, key, { algorithms: ['EdDSA'] }));
    assert(openssl(item.publicKeyJwk, Buffer.from(`${header}.${payload}`), decode(sig), 15), `OpenSSL JWS ${item.id}`);
    assert(!openssl(item.publicKeyJwk, Buffer.from(`${header}.${payload}`), bad, 15), `OpenSSL damaged JWS ${item.id}`);
    opensslChecks++; mutationsRejected += 2;
  }
  // Ledger preimages are reconstructed separately by audit.mjs and by dnspython.
  // Use dnspython to export its RFC4034 preimages, avoiding our own DNS parser here.
  const python = process.env.LTP_PYTHON || 'python3';
  const dns = run(python, [fileURLToPath(new URL('dnspython-audit.py', import.meta.url))]);
  assert.equal(dns.status, 0, dns.stderr);
  const dnsReport = JSON.parse(dns.stdout);
  const preimages = run(python, [fileURLToPath(new URL('rrsig-preimages.py', import.meta.url))]);
  assert.equal(preimages.status, 0, preimages.stderr);
  for (const item of JSON.parse(preimages.stdout)) {
    assert(openssl(item.jwk, decode(item.message), decode(item.signature), item.algorithm), `OpenSSL RRSIG ${item.algorithm}`);
    const bad = decode(item.signature); bad[0] ^= 1;
    assert(!openssl(item.jwk, decode(item.message), bad, item.algorithm));
    opensslChecks++; mutationsRejected++;
  }
  const version = run(process.env.LTP_OPENSSL || 'openssl', ['version']);
  assert.equal(version.status, 0, version.stderr);
  console.log(JSON.stringify({ attribution: 'verificación cruzada (mismo autor)',
    primitiveBackendFamily: 'OpenSSL', independentPrimitiveBackends: false,
    nodeOpenSSL: process.versions.openssl,
    openssl: version.stdout.trim(), jose: '6.2.3', joseChecks, opensslChecks,
    mutationsRejected, dns: dnsReport, discrepancies: [], independentReviewer: false }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
