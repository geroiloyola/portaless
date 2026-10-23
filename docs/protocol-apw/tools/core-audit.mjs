// CC BY 4.0. Read-only static-asset/primitive audit, NOT an LTP resolver.
// It never evaluates trust policy, sends a transcript, schedules work or runs A/B.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020.js';
import { compactVerify, importJWK } from 'jose';

const root = new URL('../vectors/ltp/v0.2/', import.meta.url);
const spec = new URL('../../../', root);
const json = url => JSON.parse(readFileSync(url, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('base64url');
const digest = value => hash(Buffer.from(canonicalize(value)));
const manifest = json(new URL('manifest.json', root));
const originals = json(new URL('../v0.1/manifest.json', root));
assert.equal(digest(originals), 'fbc9_xl0gKJlfH7JCslUsoOgHoQNrFuVRGdyPKEme0U');
assert.equal(manifest.originalCorpusDigest, digest(originals));
assert.equal(manifest.schemaBundleDigest, digest(json(new URL('schemas/v0.1/manifest.json', spec))));
assert.equal(manifest.numericExtensionDigest, 'RLmrcBc3SjFN1Mephzw6y7h3N5_mzKN9oLxLRkTZH1g');
assert.equal(manifest.numericExtensionDigest, digest(json(new URL('../v0.1/numeric-serialization.json', root))));
const frozen = new Map();
for (const entry of manifest.fixtures) {
  assert.match(entry.file, /^(?:\.\.\/v0\.1\/)?[a-z0-9-]+\.json$/);
  assert(!frozen.has(entry.file));
  const data = json(new URL(entry.file, root));
  if (process.argv.includes('--tamper-for-test') && entry.file === 'core-01-bootstrap.json') data.cases[0].expected.resourceGrant = true;
  assert.equal(digest(data), entry.digest, `frozen candidate asset: ${entry.file}`);
  frozen.set(entry.file, data);
}
assert.equal(manifest.fixtures.length, originals.fixtures.length + 10);
for (const old of originals.fixtures) assert.equal(manifest.fixtures.find(e => e.file === `../v0.1/${old.file}`)?.digest, old.digest);

const artifacts = frozen.get('signatures.json').artifacts;
const proofTemplates = frozen.get('proofs.json').proofs;
const imported = new Map();
let originalSignatures = 0, invalidSignatures = 0, josePolicyNegatives = 0;
function safeNumbers(value) {
  if (typeof value === 'number') assert(Number.isSafeInteger(value), 'signed numeric payload must use safe integers');
  else if (value && typeof value === 'object') for (const v of Object.values(value)) safeNumbers(v);
}
for (const [id, item] of Object.entries(artifacts)) {
  assert.equal(item.soloPruebas, true);
  assert.match(item.wireHex, /^(?:[0-9a-f]{2})+$/);
  const wire = Buffer.from(item.wireHex, 'hex');
  assert.equal(hash(wire), id, 'original compact JWS commitment');
  const compact = wire.toString('ascii');
  const [header, payload, signature] = compact.split('.');
  assert(header && payload && signature);
  const h = Buffer.from(header, 'base64url'), p = Buffer.from(payload, 'base64url');
  assert.equal(canonicalize(JSON.parse(h)), h.toString());
  assert.equal(canonicalize(JSON.parse(p)), p.toString());
  safeNumbers(JSON.parse(p));
  const input = Buffer.from(`${header}.${payload}`);
  assert.equal(hash(input), item.signingInputDigest);
  assert.equal(hash(p), item.payloadDigest);
  assert.equal(verify(null, input, createPublicKey({ key: item.publicJwk, format: 'jwk' }), Buffer.from(signature, 'base64url')), item.signatureValid);
  if (!imported.has(item.publicJwk.x)) imported.set(item.publicJwk.x, await importJWK(item.publicJwk, 'EdDSA'));
  let accepted = true;
  try { await compactVerify(compact, imported.get(item.publicJwk.x), { algorithms: ['EdDSA'] }); }
  catch { accepted = false; }
  assert.equal(accepted, item.joseAccepted);
  if (item.signatureValid) originalSignatures++; else invalidSignatures++;
  if (!item.joseAccepted) josePolicyNegatives++;
}
assert.equal(Object.keys(artifacts).length, manifest.signatureArtifacts);

function expand(value) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$jws')) {
      assert.deepEqual(Object.keys(value), ['$jws']);
      assert(Object.hasOwn(artifacts, value.$jws));
      return Buffer.from(artifacts[value.$jws].wireHex, 'hex').toString('ascii');
    }
    if (Array.isArray(value)) return value.map(expand);
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, expand(v)]));
  }
  return value;
}
function pointer(value, path) {
  if (!path) return value;
  assert(path.startsWith('/'));
  return path.slice(1).split('/').reduce((obj, name) => {
    assert(!['__proto__', 'constructor', 'prototype'].includes(name));
    assert(Object.hasOwn(obj, name));
    return obj[name];
  }, value);
}
function materialize(c) {
  assert(Object.hasOwn(proofTemplates, c.input.base));
  const obj = structuredClone(proofTemplates[c.input.base]);
  for (const op of c.input.patch) {
    const split = op.path.lastIndexOf('/');
    const parent = pointer(obj, op.path.slice(0, split)), key = op.path.slice(split+1);
    assert(!['__proto__', 'constructor', 'prototype'].includes(key));
    if (op.op !== 'add') assert(Object.hasOwn(parent, key), `${c.id}: patch target ${op.path}`);
    if (op.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key]; }
    else { assert(['replace', 'add'].includes(op.op)); parent[key] = structuredClone(op.value); }
  }
  return expand(obj);
}

// Schema/byte checks do not compute the supplied semantic expected verdict.
const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
for (const name of ['common', 'svri-projection', 'ltp-proof-package', 'ltp-resolution-request', 'ltp-resolution-result']) ajv.addSchema(json(new URL(`schemas/v0.1/${name}.schema.json`, spec)));
const requestSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-request');
const resultSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-result');
const slug = heading => heading.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replaceAll(' ', '-');
const contractCache = new Map();
function contract(ref) {
  const target = new URL(ref, root);
  assert(target.href.startsWith(new URL('../../../../', root).href));
  assert.equal(target.protocol, 'file:');
  const anchor = decodeURIComponent(target.hash.slice(1));
  target.hash = '';
  if (!contractCache.has(target.href)) {
    const text = readFileSync(target, 'utf8');
    const anchors = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1])));
    for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) anchors.add(m[1]);
    contractCache.set(target.href, anchors);
  }
  assert(contractCache.get(target.href).has(anchor), `missing direct contract reference: ${ref}`);
}
const coverage = frozen.get('coverage.json');
const ids = new Set();
const areaCounts = {};
const serviceReasons = new Set();
let schemaTargets = 0, bodyRecipes = 0, resourceObjectives = 0, rawParserTargets = 0;
for (const area of coverage.areas) {
  assert.match(area.id, /^CORE-0[1-6]$/);
  const group = frozen.get(area.file);
  assert.equal(group.area, area.id);
  assert.deepEqual(area.cases, group.cases.map(c => c.id));
  assert.deepEqual(area.expectedResults, group.cases.map(c => ({ id: c.id, reason: c.expected.reason, stage: c.expected.stage })));
  assert(group.cases.some(c => c.expected.reason === null));
  assert(group.cases.some(c => c.expected.reason !== null));
  for (const c of group.cases) {
    assert(c.id.startsWith(`${area.id}-`)); assert(!ids.has(c.id)); ids.add(c.id);
    assert.equal(c.area, area.id);
    assert(c.contracts.length); for (const ref of c.contracts) contract(ref);
    assert.equal(c.expected.resourceGrant, false);
    assert.equal(c.expected.reputationAdmitted, false);
    assert.equal(c.expected.arbitraryOriginCalls, 0);
    assert.equal(c.expected.misconduct, false);
    const data = materialize(c);
    assert.equal(requestSchema(data.request), c.expected.requestSchemaValid, `${c.id} request: ${JSON.stringify(requestSchema.errors)}`);
    assert.equal(resultSchema(data.result), c.expected.resultSchemaValid, `${c.id} result: ${JSON.stringify(resultSchema.errors)}`);
    const actualDigest = digest(data.result.package);
    if (c.id === 'CORE-05-digest-mismatch') assert.notEqual(data.result.packageDigest, actualDigest);
    else assert.equal(data.result.packageDigest, data.result.package === null ? null : actualDigest, `${c.id} package digest`);
    if (data.result.package) for (const history of data.result.package.histories) {
      const { id, ...core } = history;
      assert.equal(digest(core), id, `${c.id} history preimage`);
    }
    assert.equal(hash(Buffer.from(data.transport.response.bodyUtf8)), data.transport.response.bodyDigest);
    assert.equal(canonicalize(data.transport.response.json), data.transport.response.bodyUtf8);
    if (data.transport.attempts) {
      assert.equal(data.transport.attempts.length, c.expected.expectedTransportCalls);
      for (const attempt of data.transport.attempts) if (attempt.response) {
        assert.equal(canonicalize(attempt.response.json), attempt.response.bodyUtf8);
        assert.equal(hash(Buffer.from(attempt.response.bodyUtf8)), attempt.response.bodyDigest);
      }
    }
    schemaTargets++;
    if (c.expected.stage === 'service') {
      if (c.expected.reason) serviceReasons.add(c.expected.reason);
      assert.equal(c.expected.httpHeaders['retry-after'] ?? null, data.result.retryAfterSeconds === null ? null : String(data.result.retryAfterSeconds));
    }
    if (c.input.rawJsonHex) { assert.match(c.input.rawJsonHex, /^(?:[0-9a-f]{2})+$/); rawParserTargets++; }
    const o = c.input.objective;
    if (o) {
      resourceObjectives++;
      // Reproduce byte/sum facts only; never drive a scheduler or infer an LTP verdict.
      if (o.bodyRecipe) {
        const b = o.bodyRecipe;
        assert.match(b.unitHex, /^[0-9a-f]{2}$/);
        const bytes = Buffer.concat([Buffer.from(b.prefixHex, 'hex'), Buffer.alloc(b.repeat, Buffer.from(b.unitHex, 'hex')[0]), Buffer.from(b.suffixHex, 'hex')]);
        assert.equal(bytes.length, b.bytes); assert.equal(b.bytes, o.amount); assert.equal(hash(bytes), b.sha256); bodyRecipes++;
      }
      if (o.charges) assert.equal(o.charges.reduce((a, b) => a+b, 0), c.expected.requestedTotal);
      if (o.dnsName) assert.equal(Buffer.byteLength(o.dnsName, 'ascii'), o.amount);
      if (o.publicMethods) { assert.equal(o.publicMethods.length, o.amount); assert.equal(new Set(o.publicMethods.map(m => m.publicKeyJwk.x)).size, o.amount); }
      if (o.signedEntries) { const entries = proofTemplates[o.signedEntries.base].result.package.histories[0].entries.slice(o.signedEntries.sliceStart, o.signedEntries.sliceEnd); assert.equal(entries.length, o.amount); }
      if (o.signedAttemptRefs) { assert.equal(o.signedAttemptRefs.length, o.amount); for (const ref of o.signedAttemptRefs) assert(Object.hasOwn(artifacts, ref.$jws)); }
    }
  }
  areaCounts[area.id] = group.cases.length;
}
assert.equal(Object.keys(areaCounts).length, 6);
assert.equal(ids.size, manifest.coreCases);
const allServiceReasons = resultSchema.schema.properties.reason.enum.filter(x => x !== null);
assert.deepEqual([...serviceReasons].sort(), allServiceReasons.sort());

// Fixed signed-history primitive facts: chain digests, key-set ordering and windows.
for (const [name, encoded] of Object.entries(proofTemplates)) {
  const p = expand(encoded).result.package, h = p.histories[0];
  let prev = null;
  for (let i = 0; i < h.entries.length; i++) {
    const item = h.entries[i], claims = JSON.parse(Buffer.from(item.jws.split('.')[1], 'base64url'));
    assert.equal(claims.seq, i+1); assert.equal(item.seq, i+1); assert.equal(claims.prev, prev);
    assert(Object.hasOwn(artifacts, claims.att), 'log att preimage is an original signed source in the fixture bank');
    prev = hash(Buffer.from(item.jws));
  }
  assert.deepEqual(h.terminal, { seq: h.entries.length, hash: prev });
  const sorted = [...h.keys].sort((a, b) => a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : (a.keyId ?? '') < (b.keyId ?? '') ? -1 : (a.keyId ?? '') > (b.keyId ?? '') ? 1 : 0);
  const binding = JSON.parse(Buffer.from(h.keySetJws.split('.')[1], 'base64url'));
  assert.equal(binding.keysDigest, digest(sorted));
  for (const k of h.keys) assert.equal(k.fingerprint, digest(k.publicKeyJwk));
  if (name.startsWith('window-')) {
    const ts = Date.parse(JSON.parse(Buffer.from(h.entries[0].jws.split('.')[1], 'base64url')).ts);
    const k = h.keys[0];
    assert.equal(Date.parse(k.validFrom) <= ts && ts <= Date.parse(k.validTo), ['window-start', 'window-end'].includes(name));
  }
}
const long = expand(proofTemplates['identity-1000']).result.package.histories[0];
assert.equal(long.entries.length, 1000);
assert.equal(long.keys.length, 3);
const steps = frozen.get('core-04-history.json').cases.filter(c => /^CORE-04-long-1000-step-[123]$/.test(c.id));
assert.deepEqual(steps.map(c => materialize(c).result.package.histories[0].entries.length), [400, 400, 200]);
assert.deepEqual(steps.map(c => c.expected.verifiedThrough), [400, 800, 1000]);
assert.deepEqual(steps.map(c => c.expected.proofAccepted), [false, false, true]);

console.log(JSON.stringify({ scope: 'static assets, schema, byte preimages, signatures and arithmetic facts only',
  candidateDigest: digest(manifest), coreCases: ids.size, areas: areaCounts, pinnedAssets: manifest.fixtures.length,
  originalSignatures, invalidSignatures, josePolicyNegatives, schemaTargets, bodyRecipes, resourceObjectives, rawParserTargets,
  serviceReasonClasses: serviceReasons.size, longChainEntries: 1000, primitiveBackendFamily: 'OpenSSL',
  semanticExpectedVerdictsExecuted: false, productionEngineTested: false, networkConnections: 0 }, null, 2));
