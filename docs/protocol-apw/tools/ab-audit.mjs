// CC BY 4.0. Byte/algebra/primitive assertions on frozen fixture data only.
// No trace interpreter, resolver, policy decision, scheduler, network or budget manager.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020.js';
import { compactVerify, importJWK } from 'jose';

const root = new URL('../vectors/ltp/v0.3/', import.meta.url);
const spec = new URL('../../../', root);
const read = url => JSON.parse(readFileSync(url, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('base64url');
const c = value => Buffer.from(canonicalize(value));
const digest = value => sha(c(value));
const manifest = read(new URL('manifest.json', root));
const prior = read(new URL('../v0.2/manifest.json', root));
assert.equal(digest(prior), 'wpevxHbAUDyL5OVybTC2ANQ8ISby1hkCefwUgfSNeVg');
assert.equal(manifest.previousCorpusDigest, digest(prior));
assert.equal(manifest.schemaBundleDigest, prior.schemaBundleDigest);
assert.equal(manifest.numericExtensionDigest, prior.numericExtensionDigest);
assert.equal(manifest.originalCorpusDigest, prior.originalCorpusDigest);
const assets = new Map();
for (const entry of manifest.fixtures) {
  assert.match(entry.file, /^(?:\.\.\/v0\.[12]\/)?[a-z0-9-]+\.json$/);
  assert(!assets.has(entry.file));
  const value = read(new URL(entry.file, root));
  if (process.argv.includes('--tamper-for-test') && entry.file === 'ab-static-01.json') value.B.consumerHandoffByteRef = null;
  assert.equal(digest(value), entry.digest, `frozen composed asset: ${entry.file}`);
  assets.set(entry.file, value);
}
for (const entry of prior.fixtures) {
  const absolute = new URL(entry.file, new URL('../v0.2/', root));
  const inherited = manifest.fixtures.find(v => new URL(v.file, root).href === absolute.href);
  assert.equal(inherited?.digest, entry.digest, `preserved prior asset: ${entry.file}`);
}
assert.equal(manifest.fixtures.length, prior.fixtures.length+10);
const materials = assets.get('materials.json').materials;
for (const [id, value] of Object.entries(materials)) {
  assert.match(value.wireHex, /^(?:[0-9a-f]{2})+$/);
  const bytes = Buffer.from(value.wireHex, 'hex');
  assert.equal(sha(bytes), id); assert.equal(bytes.length, value.byteLength);
  assert.equal(value.soloPruebas, true);
  if (value.codec === 'jcs') assert.deepEqual(c(JSON.parse(bytes)), bytes, 'declared JCS bytes');
  else assert(['utf8-txt', 'ascii-jws'].includes(value.codec));
}
function bytes(ref) { assert(Object.hasOwn(materials, ref)); return Buffer.from(materials[ref].wireHex, 'hex'); }
function json(ref) { return JSON.parse(bytes(ref)); }
const priorArtifacts = assets.get('../v0.2/signatures.json').artifacts;
const priorCoverage = assets.get('../v0.2/coverage.json');
const coreIds = new Set(priorCoverage.areas.flatMap(area => area.cases));
const coverage = assets.get('coverage.json');
assert.equal(coverage.cases.length, 7);
assert.deepEqual(coverage.cases.map(v => v.id), Array.from({ length: 7 }, (_, i) => `AB-STATIC-0${i+1}`));
const ajv = new Ajv2020({ strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
for (const name of ['common', 'svri-projection', 'ltp-proof-package', 'ltp-resolution-request', 'ltp-resolution-result']) ajv.addSchema(read(new URL(`schemas/v0.1/${name}.schema.json`, spec)));
const reqSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-request');
const resSchema = ajv.getSchema('urn:ltp:schemas:0.1:resolution-result');
const slug = s => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replaceAll(' ', '-');
function contract(ref) {
  const url = new URL(ref, root);
  assert.equal(url.protocol, 'file:'); assert(url.href.startsWith(new URL('../../../../', root).href));
  const anchor = decodeURIComponent(url.hash.slice(1)); url.hash = '';
  const text = readFileSync(url, 'utf8');
  const anchors = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1])));
  for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) anchors.add(m[1]);
  assert(anchors.has(anchor), `direct contract anchor: ${ref}`);
}

let handoffs = 0, absentHandoffs = 0, byteFacts = 0, numberFacts = 0, signatures = 0, negativeSignatures = 0;
const caseReasons = [];
for (const index of coverage.cases) {
  const value = assets.get(index.file);
  assert.equal(value.id, index.id); assert.deepEqual(value.expected, index.expected); assert.deepEqual(value.contracts, index.contracts);
  assert.equal(value.execution, 'never-run-static-target');
  if (process.argv.includes('--disconnect-for-test') && value.id === 'AB-STATIC-01') value.B.consumerHandoffByteRef = value.B.initialStateByteRef;
  for (const ref of value.contracts) contract(ref);
  contract(value.authorizationContract);
  for (const source of value.sourceCoreCases) assert(coreIds.has(source), `concrete CORE source ${source}`);
  assert.equal(new Set(value.sourceCoreCases.map(id => id.slice(0, 7))).size, 6);
  for (const field of ['resourceGrant', 'reputationAdmitted', 'implementationAuthorized', 'misconduct', 'semanticVerdictObserved']) assert.equal(value.expected[field], false);
  assert.equal(value.expected.arbitraryOriginCalls, 0);
  assert.deepEqual(value.B.expectedOutgoingRequests, []);
  assert.equal(value.resourceFacts.networkInVerification, 0);
  assert.equal(value.resourceFacts.deadlineResetAllowed, false);
  assert.deepEqual(json(value.B.literalFinalOutputByteRef), value.expected);
  const config = json(value.configByteRef), handoff = json(value.A.producerHandoffByteRef);
  assert.equal(handoff.context.configDigest, digest(config));
  assert.equal(handoff.context.policyDigest, sha(bytes(value.policyByteRef)));
  assert.equal(handoff.context.startedAtMonotonicMs, value.clock.operationStartMonotonicMs);
  assert.equal(handoff.context.deadlineAtMonotonicMs, value.clock.deadlineMonotonicMs);
  assert.deepEqual(json(value.resourceFacts.sharedContextByteRef), handoff.context);
  assert.equal(value.clock.verificationEntryWallSeconds, value.clock.acquisitionWallSeconds+Math.floor(handoff.elapsedAtHandoffMs/1000));
  const [doh, indexPacket] = value.A.transcripts;
  assert.equal(indexPacket.request.url, config.index);
  assert.deepEqual(indexPacket.request.headers, { 'content-type': 'application/json', accept: 'application/json' });
  assert.equal(doh.request.headers.accept, 'application/dns-json');
  assert.equal(doh.response.tlsAuthenticated, true); assert.equal(indexPacket.response.tlsAuthenticated, true);
  assert(doh.request.url.startsWith(config.doh+'?'));
  const dns = json(doh.response.bodyByteRef);
  assert.equal(value.A.literalSelectedTtlExpiry, value.clock.acquisitionWallSeconds+dns.Answer[0].TTL);
  // A fixed JSON-quoted TXT field at a recorded pointer: no DNS selection/parser.
  const quotedTxt = JSON.parse(dns.Answer[0].data);
  assert.deepEqual(Buffer.from(quotedTxt, 'utf8'), bytes(value.A.selectedTxtByteRef));
  assert.deepEqual(c(JSON.parse(quotedTxt)), bytes(value.A.rootByteRef));
  const request = json(indexPacket.request.bodyByteRef), offered = json(indexPacket.response.bodyByteRef);
  assert(reqSchema(request), value.id+' request schema'); assert(resSchema(offered), value.id+' result schema');
  assert.equal(offered.packageDigest, digest(offered.package));
  assert.deepEqual(c(offered.package), bytes(value.byteBindings.offeredPackageByteRef));
  const p = offered.package, h = p.histories[0], rootValue = json(value.A.rootByteRef);
  const { id, ...historyCore } = h;
  assert.equal(id, digest(historyCore)); assert.equal(p.identities[0].historyRef, id);
  assert.equal(value.comparisons[0].left, rootValue.k);
  assert.equal(value.comparisons[0].right, digest(p.identities[0].didDocument.verificationMethod[0].publicKeyJwk));
  assert.deepEqual(c(p.identities[0].didDocument.verificationMethod[0].publicKeyJwk), bytes(value.byteBindings.didPublicJwkByteRef));
  const target = json(value.byteBindings.stableTargetByteRef), signedManifest = json(value.byteBindings.manifestPayloadByteRef);
  const { iat, ...withoutIat } = signedManifest;
  assert.equal(typeof iat, 'number'); assert.deepEqual(target, withoutIat);
  const setPayload = JSON.parse(Buffer.from(h.keySetJws.split('.')[1], 'base64url'));
  assert.equal(setPayload.keysDigest, sha(bytes(value.byteBindings.sortedPublicRecordsByteRef)));
  if (value.B.consumerHandoffByteRef === null) {
    absentHandoffs++;
    assert.equal(value.A.handoffDelivered, false); assert.equal(handoff.root, null); assert.equal(handoff.packageByteRef, null);
  } else {
    handoffs++;
    assert.deepEqual(bytes(value.A.producerHandoffByteRef), bytes(value.B.consumerHandoffByteRef), 'producer/consumer byte transfer');
    assert.deepEqual(json(value.B.consumerHandoffByteRef), handoff);
    assert.equal(handoff.packageDigest, offered.packageDigest);
    assert.deepEqual(bytes(handoff.packageByteRef), c(p));
    assert.equal(handoff.root.rootManifestDigest, sha(bytes(value.A.rootByteRef)));
    assert.equal(handoff.root.validUntil, value.A.literalSelectedTtlExpiry);
    assert.equal(handoff.targetManifestDigest, sha(bytes(value.byteBindings.stableTargetByteRef)));
    assert.equal(handoff.keySetDigest, setPayload.keysDigest);
  }
  for (const fact of value.mathematicalFacts) {
    if (fact.kind === 'bytes') {
      byteFacts++;
      if (fact.expected === 'absent') assert.equal(fact.right, null);
      else assert.equal(bytes(fact.left).equals(bytes(fact.right)), fact.expected === 'equal', fact.id);
    } else if (fact.kind === 'sum') {
      numberFacts++; assert(fact.values.every(Number.isSafeInteger));
      assert.equal(fact.values.reduce((a, b) => a+b, 0), fact.expected, fact.id);
    } else {
      numberFacts++; assert.equal(fact.kind, 'lt'); assert(Number.isSafeInteger(fact.left) && Number.isSafeInteger(fact.right));
      assert.equal(fact.left < fact.right, fact.expected, fact.id);
    }
  }
  for (const comparison of value.comparisons) assert.equal(comparison.left === comparison.right, comparison.equal, comparison.id);
  assert.equal(value.resourceFacts.countedBodyByteRefs.length, handoff.context.httpAttemptsUsed);
  assert.equal(value.resourceFacts.countedBodyByteRefs.reduce((n, ref) => n+bytes(ref).length, 0), handoff.context.bodyBytesUsed);
  assert.deepEqual(value.mathematicalFacts.find(f => f.id === 'acquisition-elapsed').values, value.resourceFacts.acquisitionAdmittedElapsedMs);
  assert.equal(value.mathematicalFacts.find(f => f.id === 'acquisition-elapsed').expected, handoff.elapsedAtHandoffMs);
  assert.equal(value.mathematicalFacts.find(f => f.id === 'root-live-at-final').left, value.clock.verificationFinalWallSeconds);
  assert.equal(value.mathematicalFacts.find(f => f.id === 'root-live-at-final').right, value.A.literalSelectedTtlExpiry);
  assert.equal(value.mathematicalFacts.find(f => f.id === 'root-live-at-entry').left, value.clock.verificationEntryWallSeconds);
  assert.equal(value.mathematicalFacts.find(f => f.id === 'root-live-at-entry').right, value.A.literalSelectedTtlExpiry);
  assert.equal(value.resourceFacts.signatureAttemptsRequested, value.signatures.length);
  if (value.B.consumerHandoffByteRef !== null) {
    const arithmeticElapsed = value.resourceFacts.acquisitionAdmittedElapsedMs.concat(value.resourceFacts.verificationProposedElapsedMs).reduce((a, b) => a+b, 0);
    assert.equal(value.resourceFacts.verificationTimeline.at(-1).elapsedMs, arithmeticElapsed);
    assert.equal(value.clock.verificationFinalWallSeconds, value.clock.acquisitionWallSeconds+Math.floor(arithmeticElapsed/1000));
  }
  assert.equal(value.B.declaredSlices.length, 3);
  for (let i = 0; i < 3; i++) {
    const slice = value.B.declaredSlices[i];
    const input = json(slice.inputStateByteRef), output = json(slice.outputStateByteRef);
    assert.equal(input.seq, i); assert.equal(output.seq, i+1);
    assert.equal(output.hash, sha(Buffer.from(h.entries[i].jws)));
    for (const field of ['operationId', 'clientScope', 'rootScope', 'startedAtMonotonicMs', 'deadlineAtMonotonicMs', 'configDigest', 'httpAttemptsUsed', 'bodyBytesUsed']) {
      assert.equal(input.context[field], handoff.context[field]); assert.equal(output.context[field], handoff.context[field]);
    }
    assert.equal(input.context.signatureAttemptsUsed, [2, 3, 4][i]);
    assert.equal(output.context.signatureAttemptsUsed, [3, 4, 5][i]);
    const claims = JSON.parse(Buffer.from(h.entries[i].jws.split('.')[1], 'base64url'));
    const previous = i === 0 ? null : sha(Buffer.from(h.entries[i-1].jws));
    assert.equal(claims.prev === previous, value.byteBindings.previousHashMatches[i]);
  }
  const one = json(value.B.declaredSlices[0].outputStateByteRef), two = json(value.B.declaredSlices[1].inputStateByteRef);
  assert.equal(one.trustPolicyDigest, value.comparisons[3].left); assert.equal(two.trustPolicyDigest, value.comparisons[3].right);
  for (const evidence of value.signatures) {
    const wire = bytes(evidence.wireByteRef), publicJwk = json(evidence.publicJwkByteRef);
    assert.equal(sha(wire), evidence.artifactId);
    assert.equal(wire.toString('hex'), priorArtifacts[evidence.artifactId].wireHex);
    assert.deepEqual(publicJwk, priorArtifacts[evidence.artifactId].publicJwk);
    const [header, payload, signature] = wire.toString('ascii').split('.');
    assert.deepEqual(Buffer.from(payload, 'base64url'), bytes(evidence.payloadByteRef));
    const input = Buffer.from(header+'.'+payload);
    assert.equal(verify(null, input, createPublicKey({ key: publicJwk, format: 'jwk' }), Buffer.from(signature, 'base64url')), evidence.signatureValid);
    let valid = true;
    try { await compactVerify(wire.toString('ascii'), await importJWK(publicJwk, 'EdDSA'), { algorithms: ['EdDSA'] }); }
    catch { valid = false; }
    assert.equal(valid, evidence.signatureValid);
    signatures++; if (!evidence.signatureValid) negativeSignatures++;
  }
  caseReasons.push(value.expected.reason);
}
assert.deepEqual(caseReasons, [null, 'dnssec_required', 'key_mismatch', 'checkpoint_required', 'deadline_exceeded', 'freshness_unproven', 'bad_signature']);
assert.equal(manifest.totalTargets, 369);
console.log(JSON.stringify({ candidateDigest: digest(manifest), cases: 7, totalTargets: 369,
  preservedV02Digest: digest(prior), pinnedAssets: manifest.fixtures.length, materials: Object.keys(materials).length,
  identicalHandoffs: handoffs, absentHandoffs, byteFacts, numberFacts, signatureFacts: signatures,
  negativeSignatureFacts: negativeSignatures, primitiveBackendFamily: 'OpenSSL',
  semanticVerdictsExecuted: false, traceExecuted: false, networkConnections: 0, authorizationGranted: false }, null, 2));
