// Fixture primitives only: the CLI is the same OpenSSL family, not an S4 backend.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('OpenSSL CLI cross-checks every core signing key, original long-chain endpoints and both mutated signatures', () => {
  const root = new URL('../vectors/ltp/v0.2/', import.meta.url);
  const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
  const artifacts = read('signatures.json').artifacts;
  const templates = read('proofs.json').proofs;
  const chosen = new Set(), publicCoordinates = new Set();
  for (const [id, item] of Object.entries(artifacts)) {
    const header = JSON.parse(Buffer.from(Buffer.from(item.wireHex, 'hex').toString().split('.')[0], 'base64url'));
    if (!publicCoordinates.has(item.publicJwk.x)) { publicCoordinates.add(item.publicJwk.x); chosen.add(id); }
    if (!item.signatureValid || header.alg !== 'EdDSA') chosen.add(id);
  }
  const chain = templates['identity-1000'].result.package.histories[0].entries;
  for (const index of [0, 499, 999]) chosen.add(chain[index].jws.$jws);
  const temp = mkdtempSync(join(tmpdir(), 'ltp-core-openssl-'));
  let negatives = 0;
  try {
    for (const id of chosen) {
      const item = artifacts[id];
      const [header, payload, signature] = Buffer.from(item.wireHex, 'hex').toString('ascii').split('.');
      writeFileSync(join(temp, 'public.pem'), createPublicKey({ key: item.publicJwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }));
      writeFileSync(join(temp, 'input'), Buffer.from(`${header}.${payload}`));
      writeFileSync(join(temp, 'signature'), Buffer.from(signature, 'base64url'));
      const result = spawnSync(process.env.LTP_OPENSSL || 'openssl', ['pkeyutl', '-verify', '-rawin', '-pubin', '-inkey', join(temp, 'public.pem'), '-sigfile', join(temp, 'signature'), '-in', join(temp, 'input')], { encoding: 'utf8', timeout: 10_000 });
      assert(!result.error, String(result.error));
      assert.equal(result.status === 0, item.signatureValid, `core OpenSSL signature ${id}`);
      if (!item.signatureValid) negatives++;
    }
    assert.equal(publicCoordinates.size, 3);
    assert.equal(negatives, 2);
    assert(chosen.size >= 8);
    console.log(JSON.stringify({ coreOpenSSLChecks: chosen.size, negativeSignatures: negatives, primitiveBackendFamily: 'OpenSSL', independentPrimitives: false }));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
