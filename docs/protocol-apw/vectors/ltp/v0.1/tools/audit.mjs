// CC BY 4.0. Read-only offline fixture audit, NOT a production LTP verifier.
// Cross-check (same author / verificación cruzada, mismo autor). No runtime imports.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020.js';

const root = new URL('../', import.meta.url);
const schemasRoot = new URL('../../../schemas/v0.1/', root);
const hash = bytes => createHash('sha256').update(bytes).digest('base64url');
const digest = object => hash(Buffer.from(canonicalize(object), 'utf8'));
const decode = text => Buffer.from(text, 'base64url');
function assertSignedIntegers(value) {
  if (typeof value === 'number') assert(Number.isSafeInteger(value), 'signed payload numbers must be safe integers');
  else if (value && typeof value === 'object') for (const v of Object.values(value)) assertSignedIntegers(v);
}
const json = url => JSON.parse(readFileSync(url, 'utf8'));
const manifest = json(new URL('manifest.json', root));
const fixtures = new Map();
for (const entry of manifest.fixtures) {
  assert.match(entry.file, /^[a-z0-9-]+\.json$/);
  assert(!fixtures.has(entry.file));
  const data = json(new URL(entry.file, root));
  if (process.argv.includes('--corrupt-in-memory-for-test') && fixtures.size === 0) data.id = 'corrupted-fixture';
  assert.equal(digest(data), entry.digest, `frozen fixture digest: ${entry.file}`);
  fixtures.set(entry.file, data);
}

function pointer(value, path) {
  if (!path) return value;
  assert(path.startsWith('/'));
  return path.slice(1).split('/').reduce((v, part) => {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    assert(!['__proto__', 'constructor', 'prototype'].includes(key));
    assert(Object.hasOwn(v, key), `missing fixture pointer ${path}`);
    return v[key];
  }, value);
}

function materialize(name, seen = new Set()) {
  assert(!seen.has(name), 'cyclic fixture base');
  seen.add(name);
  const fixture = fixtures.get(name);
  assert(fixture, `missing fixture ${name}`);
  if (!fixture.base) return structuredClone(fixture);
  const result = materialize(fixture.base, seen);
  for (const operation of fixture.patch) {
    const split = operation.path.lastIndexOf('/');
    const parent = pointer(result, operation.path.slice(0, split));
    const key = operation.path.slice(split + 1);
    assert(!['__proto__', 'constructor', 'prototype'].includes(key));
    if (operation.op !== 'add') assert(Object.hasOwn(parent, key), `RFC6902 target ${operation.path}`);
    if (operation.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else {
      assert(['add', 'replace'].includes(operation.op));
      parent[key] = structuredClone(operation.value);
    }
  }
  result.id = fixture.id;
  result.expected = structuredClone(fixture.expected);
  return result;
}

const ajv = new Ajv2020({ strict: false, allErrors: true, useDefaults: false, coerceTypes: false, removeAdditional: false });
const schemaFiles = ['common', 'svri-projection', 'ltp-proof-package', 'ltp-resolution-request', 'ltp-resolution-result'];
const schemaDigests = {};
const schemaManifest = json(new URL('manifest.json', schemasRoot));
assert.equal(schemaManifest.schemas.length, schemaFiles.length);
for (const name of schemaFiles) {
  const schema = json(new URL(`${name}.schema.json`, schemasRoot));
  const pinned = schemaManifest.schemas.find(s => s.file === `${name}.schema.json`);
  assert(pinned);
  assert.equal(schema.$id, pinned.id);
  assert.equal(digest(schema), pinned.digest, `frozen schema digest: ${name}`);
  assert(ajv.validateSchema(schema), JSON.stringify(ajv.errors));
  ajv.addSchema(schema);
  schemaDigests[name] = digest(schema);
}
const requestSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-request');
const resultSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-result');
const projectionSchema = ajv.getSchema('urn:ltp:schemas:0.1:svri-projection');
let resolutionCases = 0;
for (const [name, raw] of fixtures) {
  if (!raw.base && !raw.result) continue;
  const f = materialize(name);
  assert(requestSchema(f.request), `${name} request: ${JSON.stringify(requestSchema.errors)}`);
  assert.equal(resultSchema(f.result), f.expected.schemaValid, `${name}: ${JSON.stringify(resultSchema.errors)}`);
  if (f.expected.reason === 'digest_mismatch') assert.notEqual(digest(f.result.package), f.result.packageDigest);
  else assert.equal(digest(f.result.package), f.result.packageDigest, `${name}: outer digest must not mask intended failure`);
  assert.equal(f.local.resourceGrant, false);
  assert.equal(f.expected.resourceGrant, false);
  resolutionCases++;
}

function jws(compact, jwk) {
  const [header, payload, signature] = compact.split('.');
  assert.equal(signature.length, 86);
  const signingInput = Buffer.from(`${header}.${payload}`, 'ascii');
  return { header: decode(header), payload: decode(payload), signature: decode(signature), signingInput,
    valid: verify(null, signingInput, createPublicKey({ key: jwk, format: 'jwk' }), decode(signature)) };
}
const ledger = fixtures.get('crypto-ledger.json');
for (const item of ledger.jws) {
  const compact = pointer(fixtures.get(item.ref.file), item.ref.pointer);
  const fact = jws(compact, item.publicKeyJwk);
  assertSignedIntegers(JSON.parse(fact.payload));
  assert(fact.valid, `${item.id}: cross-checked Ed25519 (same author)`);
  assert.equal(hash(fact.header), item.protectedDigest);
  assert.equal(hash(fact.payload), item.payloadDigest);
  assert.equal(hash(fact.signingInput), item.signingInputDigest);
  assert.equal(hash(Buffer.from(compact, 'ascii')), item.sha256);
  assert.equal(canonicalize(JSON.parse(fact.header)), fact.header.toString());
  assert.equal(canonicalize(JSON.parse(fact.payload)) === fact.payload.toString(), item.canonicalPayload);
}
const base = fixtures.get('valid-proof-chain.json');
const pkg = base.result.package;
assert.equal(digest(pkg.histories[0].keys[0].publicKeyJwk), pkg.histories[0].keys[0].fingerprint);
assert.equal(canonicalize(base.local.onlineObservation.manifest), ledger.rootManifestUtf8);
assert.equal(hash(Buffer.from(ledger.rootManifestUtf8)), ledger.rootManifestDigest);
assert.equal(digest(pkg.histories[0].keys), ledger.keySetDigest);
const { id, ...historyWithoutId } = pkg.histories[0];
assert.equal(digest(historyWithoutId), id);
assert.equal(id, ledger.historyId);
assert.equal(digest([...new Set(pkg.attestations.map(s => hash(Buffer.from(s, 'ascii'))))].sort()), ledger.evidenceSetDigest);
for (let i = 0; i < 2; i++) {
  const payload = JSON.parse(decode(pkg.histories[0].entries[i].jws.split('.')[1]));
  assert.equal(payload.att, hash(Buffer.from(pkg.attestations[i], 'ascii')));
  assert.equal(payload.prev, i ? hash(Buffer.from(pkg.histories[0].entries[i - 1].jws, 'ascii')) : null);
}
const siteKey = pkg.histories[0].keys[0].publicKeyJwk;
assert.equal(jws(materialize('invalid-signature.json').result.package.identities[0].manifestJws, siteKey).valid, false);
assert.equal(jws(materialize('invalid-log-signature.json').result.package.histories[0].entries[0].jws, siteKey).valid, false);
assert.equal(jws(materialize('invalid-attestation-signature.json').result.package.attestations[1], base.local.policy.issuerRecords[0].publicKeyJwk).valid, false);
const expired = materialize('expired-key-set.json');
const expiredBinding = jws(expired.result.package.histories[0].keySetJws, siteKey);
assert(expiredBinding.valid);
assert.equal(JSON.parse(expiredBinding.payload).exp, expired.local.now);
const checkpoint = materialize('valid-continuation.json').local.checkpoints[0];
assert.equal(digest(checkpoint.core), checkpoint.id);
assert.equal(digest(checkpoint.sources), checkpoint.core.sourceStateDigest);
assert.equal(materialize('expired-checkpoint.json').local.checkpoints[0].retainedUntil, base.local.now);
assert.equal(materialize('valid-bootstrap-step-1.json').expected.resume.previousHash, checkpoint.core.hash);

// Deliberately limited parser for these uncompressed, single-RRset fixtures.
// It is a byte audit, not a network DNS parser or general DNSSEC validator.
function nameAt(b, offset) {
  const start = offset, labels = [];
  while (b[offset] !== 0) {
    const length = b[offset++];
    assert(length <= 63 && offset + length < b.length);
    labels.push(b.subarray(offset, offset + length).toString('ascii'));
    offset += length;
  }
  return { name: labels.join('.') + '.', next: offset + 1, bytes: b.subarray(start, offset + 1) };
}
function recordAt(b, offset) {
  const name = nameAt(b, offset), at = name.next;
  const type = b.readUInt16BE(at), length = b.readUInt16BE(at + 8);
  assert(at + 10 + length <= b.length);
  return { name, type, fixed: b.subarray(at, at + 10), data: b.subarray(at + 10, at + 10 + length), next: at + 10 + length };
}
function wireFacts(text) {
  const wire = decode(text);
  assert.equal(wire.readUInt16BE(4), 1); assert.equal(wire.readUInt16BE(6), 2);
  const question = nameAt(wire, 12);
  const rr = recordAt(wire, question.next + 4), sig = recordAt(wire, rr.next);
  assert.equal(sig.type, 46); assert.equal(sig.next, wire.length);
  const signer = nameAt(sig.data, 18);
  const canonicalFixed = Buffer.from(rr.fixed);
  sig.data.copy(canonicalFixed, 4, 4, 8); // RRSIG original TTL, not transport TTL.
  const message = Buffer.concat([sig.data.subarray(0, signer.next), rr.name.bytes, canonicalFixed, rr.data]);
  return { rr, message, signature: sig.data.subarray(signer.next), inception: sig.data.readUInt32BE(12),
    expiry: sig.data.readUInt32BE(8), keyTag: sig.data.readUInt16BE(16), algorithm: sig.data[2], signer: signer.name };
}
function signatureValid(fact, jwk) {
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  return fact.algorithm === 15 ? verify(null, fact.message, key, fact.signature) :
    verify('sha256', fact.message, fact.algorithm === 13 ? { key, dsaEncoding: 'ieee-p1363' } : key, fact.signature);
}
let dnsSignatures = 0;
function keyBytes(jwk) {
  if (jwk.kty === 'OKP') return decode(jwk.x);
  if (jwk.kty === 'EC') return Buffer.concat([decode(jwk.x), decode(jwk.y)]);
  const e = decode(jwk.e);
  assert(e.length < 256);
  return Buffer.concat([Buffer.from([e.length]), e, decode(jwk.n)]);
}
function keyTag(data) {
  let a = 0;
  for (let i = 0; i < data.length; i++) a += data[i] << (i % 2 === 0 ? 8 : 0);
  return (a + (a >>> 16)) & 65535;
}
for (const proof of Object.values(fixtures.get('dnssec-proofs.json').profiles)) {
  const facts = proof.messages.map(wireFacts);
  for (const item of proof.rrsets) {
    const fact = facts[item.wireIndex];
    assert.equal(hash(fact.message), item.signingInputDigest);
    assert.equal(fact.signature.toString('base64url'), item.signature);
    assert.equal(fact.algorithm, proof.algorithm);
    assert.equal(fact.signer, item.signer);
    assert.equal(fact.rr.name.name, item.owner);
    assert.equal(fact.rr.type, item.type);
    const signingKey = facts[item.wireIndex < 2 ? 0 : 2].rr.data;
    assert.deepEqual(keyBytes(item.publicKeyJwk), signingKey.subarray(4));
    assert.equal(fact.keyTag, keyTag(signingKey));
    assert(signatureValid(fact, item.publicKeyJwk), `DNSSEC ${proof.algorithm}: native crypto`);
    assert(fact.inception < base.local.now && base.local.now < fact.expiry);
    assert.equal(fact.expiry, proof.signatureValidUntil);
    for (const time of fixtures.get('dnssec-proofs.json').signatureTimeCases) {
      assert.equal(fact.inception <= time.now && time.now <= fact.expiry, time.valid, 'RFC4035 5.3.1 inclusive DNSSEC signature interval');
    }
    dnsSignatures++;
  }
  assert.equal(facts[0].rr.data.toString('base64url'), proof.trustAnchor.dnskeyRdata);
  assert.equal(facts[2].rr.data.toString('base64url'), proof.zoneDnskeyRdata);
  assert.equal(createHash('sha256').update(Buffer.concat([Buffer.from('076578616d706c6500', 'hex'), facts[2].rr.data])).digest('hex'), proof.dsDigestHex);
  assert.equal(facts[1].rr.data.subarray(4).toString('hex'), proof.dsDigestHex);
  assert.equal(facts[1].rr.data.readUInt16BE(0), keyTag(facts[2].rr.data));
  assert.equal(facts[1].rr.data[2], proof.algorithm); assert.equal(facts[1].rr.data[3], 2);
  let text = '', at = 0;
  while (at < facts[3].rr.data.length) {
    const n = facts[3].rr.data[at++]; text += facts[3].rr.data.subarray(at, at + n).toString('utf8'); at += n;
  }
  assert.equal(text, ledger.rootManifestUtf8);
  assert.deepEqual(materialize(`valid-offline-dnssec-${proof.algorithm}.json`).result.package.identities[0].dnsMessages, proof.messages);
}
const brokenDns = wireFacts(materialize('offline-invalid-txt-signature.json').result.package.identities[0].dnsMessages[3]);
assert.equal(signatureValid(brokenDns, fixtures.get('dnssec-proofs.json').profiles['15'].rrsets[3].publicKeyJwk), false);

// Cross-check (same author): BigInt arithmetic versus Python Fraction authoring.
const gcd = (a, b) => b ? gcd(b, a % b) : a < 0n ? -a : a;
const rat = (a, b = 1n) => { const g = gcd(a, b); return [a / g, b / g]; };
const parse = s => { const [a, b = '1'] = s.split('/'); return rat(BigInt(a), BigInt(b)); };
const add = (a, b) => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => rat(a[0] * b[0], a[1] * b[1]);
const div = (a, b) => rat(a[0] * b[1], a[1] * b[0]);
const cmp = (a, b) => a[0] * b[1] - b[0] * a[1];
const sum = xs => xs.reduce(add, [0n, 1n]);
const integer = n => [BigInt(n), 1n];
const mathCases = fixtures.get('svri-math.json').cases;
for (const c of mathCases) {
  const dims = c.input.dimensions.filter(d => cmp(parse(d.weight), integer(0)) > 0n);
  const n = dims.length, weight = sum(dims.map(d => parse(d.weight)));
  const mapped = dims.map(d => {
    const s = div(add(integer(12), parse(d.weightedValue)), add(integer(3), parse(d.weight)));
    return div(mul(integer(10), add(s, integer(-1))), integer(6));
  });
  const score = n ? div(sum(mapped), integer(n)) : integer(5);
  const prior = n ? div(integer(3 * n), add(integer(3 * n), weight)) : integer(1);
  for (const [field, value] of [['score', score], ['priorShare', prior], ['effectiveWeight', weight]]) {
    assert.deepEqual(c.expected.rational[field], { numerator: value[0].toString(), denominator: value[1].toString() }, `${c.id}: ${field}`);
    assert.equal(c.expected.projection[field], Number(value[0]) / Number(value[1]));
  }
  const incomplete = c.input.counts[0] + c.input.counts[1] === 0;
  const inference = cmp(prior, [1n, 2n]) > 0n;
  const level = incomplete ? 'pending' : cmp(score, integer(5)) < 0n ? 'low' : cmp(score, integer(7)) < 0n || inference ? 'verify' : cmp(score, integer(9)) < 0n ? 'safe' : 'trusted';
  assert.equal(c.expected.projection.dimensionCount, n);
  assert.equal(c.expected.projection.incompleteData, incomplete);
  assert.equal(c.expected.projection.isInference, inference);
  assert.equal(c.expected.publicLevel, level);
  assert(projectionSchema(c.expected.projection));
}
const encoding = fixtures.get('encoding.json');
for (const c of encoding.cases) {
  assert.equal(canonicalize(c.input), c.canonicalUtf8);
  assert.equal(Buffer.from(c.canonicalUtf8).toString('hex'), c.canonicalHex);
  assert.equal(hash(Buffer.from(c.canonicalUtf8)), c.digest);
}
// The seven malformed wire inputs are future strict-parser rejection targets,
// not claims that JSON.parse is a conformant parser or that an engine was run.
assert.equal(encoding.invalidJson.length, 7);

// Numeric extension is separately pinned until the owner approves a new corpus digest.
const numeric = json(new URL('numeric-serialization.json', root));
assert.equal(digest(numeric), 'RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g', 'frozen numeric extension digest');
for (const c of numeric.cases) {
  const value = JSON.parse(c.wire);
  assert.equal(canonicalize(value), c.canonical, `Node numeric serialization: ${c.wire}`);
  if (c.signedInteger) assertSignedIntegers(value);
  else assert.throws(() => assertSignedIntegers(value));
}
for (const wire of numeric.rejectedSignedNumbers) assert.throws(() => assertSignedIntegers(JSON.parse(wire)));
if (process.argv.includes('--signed-float-for-test')) assertSignedIntegers({ val: 0.5 });

console.log(JSON.stringify({ scope: 'offline fixture/schema/primitive/mathematical audit only',
  fixtures: fixtures.size, resolutionCases, ed25519Signatures: ledger.jws.length, dnssecSignatures: dnsSignatures,
  svriMathCases: mathCases.length, canonicalByteCases: encoding.cases.length, invalidJsonTargets: encoding.invalidJson.length,
  numericCases: numeric.cases.length, numericExtensionDigest: digest(numeric),
  corpusDigest: digest(manifest), schemaBundleDigest: digest(schemaManifest), schemaDigests, productionEngineTested: false }, null, 2));
