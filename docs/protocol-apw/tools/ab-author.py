#!/usr/bin/env python3
"""CC BY 4.0. Static A/B trace assembler, not an executable workflow or verifier.

There is no resolver, network, scheduler, budget admission or policy decision
function. Expected outcomes are literal authored targets; this assembler copies
frozen inputs and precalculates bytes/hashes and specified arithmetic facts only.
"""
import argparse
import copy
import json
import os
import sys
from pathlib import Path

SPEC = Path(__file__).resolve().parent.parent
PRIOR = SPEC / 'vectors/ltp/v0.2'
OUT = SPEC / 'vectors/ltp/v0.3'
sys.path.insert(0, str(SPEC / 'vectors/ltp/v0.1/tools'))
from author import canonical, b64, sha, digest, unb64

NOW = 1790000000
BOOT = '../../../APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md'
PACK = '../../../LTP-PROOF-PACKAGE-DRAFT-v0.1.md'
SER = '../../../LTP-SERIALIZATION-DRAFT-v0.1.md'
GATES = '../../../LTP-GATES-AND-AUTHORIZATIONS.md#canonical-gates'
LIMITS = '../../../../architecture/resolution-chain-proposal.md#approved-resource-limits'


def assemble():
    templates = json.loads((PRIOR / 'proofs.json').read_text())['proofs']
    artifacts = json.loads((PRIOR / 'signatures.json').read_text())['artifacts']
    source_cases = json.loads((PRIOR / 'core-04-history.json').read_text())['cases']
    materials = {}

    def expand(v):
        if isinstance(v, dict):
            if set(v) == {'$jws'}:
                return bytes.fromhex(artifacts[v['$jws']]['wireHex']).decode('ascii')
            return {k: expand(x) for k, x in v.items()}
        return [expand(x) for x in v] if isinstance(v, list) else v

    def blob(value, codec='jcs'):
        raw = canonical(value).encode() if codec == 'jcs' else value.encode('utf8')
        ref = b64(sha(raw))
        item = {'codec': codec, 'wireHex': raw.hex(), 'byteLength': len(raw), 'soloPruebas': True}
        if ref in materials:
            # Same bytes may be used as TXT UTF-8 and JCS: the bytes are canonical.
            assert materials[ref]['wireHex'] == item['wireHex']
        else:
            materials[ref] = item
        return ref

    base = expand(templates['identity-rotation'])
    original_package = base['result']['package']
    original_history = original_package['histories'][0]
    original_entries = original_history['entries']
    original_root = base['local']['onlineObservation']['manifest']
    policy = base['local']['policy']
    sorted_keys = sorted(original_history['keys'], key=lambda r: (r['fingerprint'], r['keyId'] or ''))
    selected_txt = canonical(original_root)
    manifest_compact = original_package['identities'][0]['manifestJws']
    manifest_payload = json.loads(unb64(manifest_compact.split('.')[1]))
    target = copy.deepcopy(manifest_payload)
    target.pop('iat')
    contracts = [BOOT+'#3-profile-independent-doh-ad-v1', PACK+'#4-identityproof-and-independent-roots',
        PACK+'#5-historyproof-completeness-and-checkpoints', SER+'#3-canonical-serialization-and-hash-ledger',
        SER+'#6-result-nulls-reasons-and-http-mapping', LIMITS, GATES]
    rows = [
        ('AB-STATIC-01', 'valid-composition', {'identity': 'verified', 'history': 'verified', 'proofAccepted': True, 'reason': None, 'stopsBefore': None}),
        ('AB-STATIC-02', 'ad-false', {'identity': 'unverified', 'history': 'not_started', 'proofAccepted': False, 'reason': 'dnssec_required', 'stopsBefore': 'A-PACKAGE'}),
        ('AB-STATIC-03', 'did-key-mismatch', {'identity': 'unverified', 'history': 'not_started', 'proofAccepted': False, 'reason': 'key_mismatch', 'stopsBefore': 'B-LOG-1'}),
        ('AB-STATIC-04', 'policy-changes-between-prefix-states', {'identity': 'unverified', 'history': 'partial', 'proofAccepted': False, 'reason': 'checkpoint_required', 'stopsBefore': 'B-LOG-2'}),
        ('AB-STATIC-05', 'shared-deadline-no-reset', {'identity': 'unavailable', 'history': 'partial', 'proofAccepted': False, 'reason': 'deadline_exceeded', 'stopsBefore': 'B-LOG-2'}),
        ('AB-STATIC-06', 'root-expires-before-promotion', {'identity': 'unavailable', 'history': 'verified', 'proofAccepted': False, 'reason': 'freshness_unproven', 'stopsBefore': 'B-PROMOTION'}),
        ('AB-STATIC-07', 'required-log-signature-mutated', {'identity': 'unverified', 'history': 'invalid', 'proofAccepted': False, 'reason': 'bad_signature', 'stopsBefore': 'B-LOG-3'}),
    ]
    files, coverage = {}, []
    for ident, variant, literal_result in rows:
        final_wall = NOW+10 if ident == 'AB-STATIC-05' else NOW+2
        package = copy.deepcopy(original_package)
        if ident == 'AB-STATIC-03':
            # Pick the known retired key deterministically, not by trust evaluation.
            package['identities'][0]['didDocument']['verificationMethod'][0]['publicKeyJwk'] = original_history['keys'][0]['publicKeyJwk']
        if ident == 'AB-STATIC-07':
            mutated = next(c for c in source_cases if c['id'] == 'CORE-04-log-bad-signature')
            ref = next(p['value'] for p in mutated['input']['patch'] if p['path'] == '/result/package/histories/0/entries/1/jws/$jws')
            package['histories'][0]['entries'][1]['jws'] = expand({'$jws': ref})
            h = package['histories'][0]
            h.pop('id')
            h['id'] = digest(h)
            package['identities'][0]['historyRef'] = h['id']
        package_ref = blob(package)
        offered = {**base['result'], 'package': package, 'packageDigest': digest(package)}
        request_ref, offered_ref = blob(base['request']), blob(offered)
        dns = copy.deepcopy(base['transport']['response']['json'])
        if ident == 'AB-STATIC-02':
            dns['AD'] = False
        if ident == 'AB-STATIC-06':
            dns['Answer'][0]['TTL'] = 1
        dns_ref = blob(dns)
        root_ref = blob(original_root)
        policy_ref = blob(policy)
        context = {'operationId': ident+'-ctx', 'clientScope': 'solo-pruebas-client', 'rootScope': 'core.vector.example',
            'startedAtMonotonicMs': 0, 'deadlineAtMonotonicMs': 10000, 'httpAttemptsUsed': 1 if ident == 'AB-STATIC-02' else 2,
            'bodyBytesUsed': materials[dns_ref]['byteLength']+(0 if ident == 'AB-STATIC-02' else materials[offered_ref]['byteLength']),
            'signatureAttemptsUsed': 0, 'policyDigest': digest(policy), 'configDigest': None}
        config = {'profile': 'configured-doh-and-index', 'doh': 'https://resolver.fixture.invalid/dns-query',
            'index': 'https://index.fixture.invalid/resolve', 'resolverId': 'operator-primary',
            'redirects': 0, 'sourceClock': 'fixed-test-clock', 'localPolicyByteRef': policy_ref,
            'limits': {'bodyBytes': 4194304, 'packageBytes': 524288, 'dohBytes': 65536,
                'signatureAttempts': 640, 'httpAttempts': 24, 'deadlineMs': 10000}}
        context['configDigest'] = digest(config)
        a_times = [2500, 2500] if ident == 'AB-STATIC-05' else [100, 100]
        a_admitted_times = [100] if ident == 'AB-STATIC-02' else a_times
        handoff_elapsed = sum(a_admitted_times)
        root_valid_until = NOW+1 if ident == 'AB-STATIC-06' else NOW+60
        root_observation = {'did': package['subject'], 'manifest': original_root, 'profile': 'independent-doh-ad-v1',
            'resolverId': 'operator-primary', 'channel': 'consumer-https-fixture', 'receivedAt': NOW,
            'validUntil': root_valid_until, 'rootManifestDigest': digest(original_root), 'observation': 'independent-online'}
        handoff = {'subject': package['subject'], 'requestId': base['request']['requestId'], 'packageDigest': digest(package),
            'packageByteRef': package_ref, 'root': root_observation, 'context': context,
            'targetManifestDigest': digest(target), 'keySetDigest': digest(sorted_keys),
            'elapsedAtHandoffMs': handoff_elapsed, 'remainingAtHandoffMs': 10000-handoff_elapsed}
        if ident == 'AB-STATIC-02':
            handoff.update({'root': None, 'packageByteRef': None, 'packageDigest': None,
                'targetManifestDigest': None, 'keySetDigest': None, 'reason': 'dnssec_required'})
        produced = blob(handoff)
        candidate_states = []
        for seq in [0, 1, 2, 3]:
            entry = package['histories'][0]['entries'][seq-1] if seq else None
            value = {'did': package['subject'], 'seq': seq, 'hash': b64(sha(entry['jws'].encode())) if seq else None,
                'rootManifestDigest': digest(original_root), 'targetManifestDigest': digest(target),
                'keySetDigest': digest(sorted_keys), 'trustPolicyDigest': digest(policy),
                'context': {**context, 'signatureAttemptsUsed': [2, 3, 4, 5][seq]}, 'trustClass': 'quarantined-proposal'}
            candidate_states.append(value)
        state_refs = [blob(s) for s in candidate_states]
        step2_input = state_refs[1]
        if ident == 'AB-STATIC-04':
            incompatible = copy.deepcopy(candidate_states[1])
            incompatible['trustPolicyDigest'] = digest({**policy, 'rulesVersion': 'changed-policy'})
            step2_input = blob(incompatible)

        # Literal proposal rows, not an instruction stream. No code dispatches them.
        a_consumed = [True, False] if ident == 'AB-STATIC-02' else [True, True]
        b_consumed = {'AB-STATIC-01': [True, True, True], 'AB-STATIC-02': [False, False, False],
            'AB-STATIC-03': [False, False, False], 'AB-STATIC-04': [True, False, False],
            'AB-STATIC-05': [True, False, False], 'AB-STATIC-06': [True, True, True],
            'AB-STATIC-07': [True, True, False]}[ident]
        b_input = None if ident == 'AB-STATIC-02' else produced
        b_times = [1000, 3999, 1] if ident == 'AB-STATIC-05' else [100, 1500, 300]
        facts = [
            {'id': 'handoff-bytes', 'kind': 'bytes', 'left': produced, 'right': b_input, 'expected': 'absent' if b_input is None else 'equal'},
            {'id': 'prefix-1-to-2', 'kind': 'bytes', 'left': state_refs[1], 'right': step2_input, 'expected': 'different' if ident == 'AB-STATIC-04' else 'equal'},
            {'id': 'acquisition-elapsed', 'kind': 'sum', 'values': a_admitted_times, 'expected': handoff_elapsed},
            {'id': 'remaining-at-handoff', 'kind': 'sum', 'values': [handoff_elapsed, 10000-handoff_elapsed], 'expected': 10000},
            {'id': 'http-body-byte-sum', 'kind': 'sum', 'values': [materials[dns_ref]['byteLength'], 0 if ident == 'AB-STATIC-02' else materials[offered_ref]['byteLength']], 'expected': context['bodyBytesUsed']},
            {'id': 'root-live-at-final', 'kind': 'lt', 'left': final_wall, 'right': root_valid_until, 'expected': ident != 'AB-STATIC-06'},
            {'id': 'root-live-at-entry', 'kind': 'lt', 'left': NOW+handoff_elapsed//1000, 'right': root_valid_until, 'expected': True},
            {'id': 'body-below-shared-cap', 'kind': 'lt', 'left': context['bodyBytesUsed'], 'right': 4194304, 'expected': True},
            {'id': 'signature-attempt-precalculation', 'kind': 'sum', 'values': [2, 1, 1, 1], 'expected': 5},
        ]
        if ident == 'AB-STATIC-05':
            facts.extend([{'id': 'shared-deadline-before-log-2', 'kind': 'sum', 'values': a_times+b_times, 'expected': 10000},
                {'id': 'shared-deadline-exclusive', 'kind': 'lt', 'left': 10000, 'right': 10000, 'expected': False},
                {'id': 'incorrect-reset-counterexample', 'kind': 'lt', 'left': 5000, 'right': 10000, 'expected': True}])
        expected = {**literal_result, 'resourceGrant': False, 'reputationAdmitted': False, 'implementationAuthorized': False,
            'misconduct': False, 'arbitraryOriginCalls': 0, 'acquisitionConsumed': a_consumed, 'logSlicesConsumed': b_consumed,
            'semanticVerdictObserved': False}
        expected['signatureAttemptsConsumed'] = {'AB-STATIC-01': 5, 'AB-STATIC-02': 0, 'AB-STATIC-03': 0,
            'AB-STATIC-04': 3, 'AB-STATIC-05': 3, 'AB-STATIC-06': 5, 'AB-STATIC-07': 4}[ident]
        expected['effectiveValidUntil'] = NOW+60 if ident == 'AB-STATIC-01' else None
        output_ref = blob(expected)
        evidence = []
        for entry in package['histories'][0]['entries']:
            token = entry['jws']; artifact_id = b64(sha(token.encode()))
            evidence.append({'artifactId': artifact_id, 'wireByteRef': blob(token, 'ascii-jws'),
                'payloadByteRef': blob(json.loads(unb64(token.split('.')[1]))),
                'publicJwkByteRef': blob(artifacts[artifact_id]['publicJwk']), 'signatureValid': artifacts[artifact_id]['signatureValid']})
        for token in [package['identities'][0]['manifestJws'], package['histories'][0]['keySetJws']]:
            artifact_id = b64(sha(token.encode()))
            evidence.append({'artifactId': artifact_id, 'wireByteRef': blob(token, 'ascii-jws'),
                'payloadByteRef': blob(json.loads(unb64(token.split('.')[1]))),
                'publicJwkByteRef': blob(artifacts[artifact_id]['publicJwk']), 'signatureValid': artifacts[artifact_id]['signatureValid']})
        did_jwk = package['identities'][0]['didDocument']['verificationMethod'][0]['publicKeyJwk']
        comparisons = [
            {'id': 'txt-current-jwk', 'left': original_root['k'], 'right': digest(did_jwk), 'equal': ident != 'AB-STATIC-03'},
            {'id': 'root-to-handoff', 'left': digest(original_root), 'right': None if ident == 'AB-STATIC-02' else handoff['root']['rootManifestDigest'], 'equal': ident != 'AB-STATIC-02'},
            {'id': 'operation-scope', 'left': context['operationId'], 'right': handoff['context']['operationId'], 'equal': True},
            {'id': 'prefix-policy-continuity', 'left': candidate_states[1]['trustPolicyDigest'],
                'right': json.loads(bytes.fromhex(materials[step2_input]['wireHex']))['trustPolicyDigest'], 'equal': ident != 'AB-STATIC-04'},
        ]
        fixture = {'format': 'ltp-static-composed-trace', 'version': '0.3', 'id': ident,
            'variant': variant, 'variantOf': None if ident == 'AB-STATIC-01' else 'AB-STATIC-01', 'authorizationContract': GATES,
            'execution': 'never-run-static-target', 'contracts': contracts,
            'sourceTemplate': {'file': '../v0.2/proofs.json', 'pointer': '/proofs/identity-rotation'},
            'sourceCoreCases': ['CORE-01-valid-root', 'CORE-02-valid-txt', 'CORE-03-valid-did', 'CORE-04-rotation-valid',
                'CORE-05-service-01-candidate', 'CORE-06-remaining-hop-deadline'],
            'configByteRef': blob(config), 'policyByteRef': policy_ref,
            'clock': {'acquisitionWallSeconds': NOW, 'verificationEntryWallSeconds': NOW+handoff_elapsed//1000, 'verificationFinalWallSeconds': final_wall,
                      'operationStartMonotonicMs': 0, 'deadlineMonotonicMs': 10000},
            'A': {'transcripts': [
                {'id': 'A-DOH', 'configuredEndpoint': 'doh', 'request': {**base['transport']['request'], 'headers': {'accept': 'application/dns-json'}},
                 'response': {'status': 200, 'tlsAuthenticated': True, 'resolverId': 'operator-primary', 'bodyByteRef': dns_ref}, 'expectedConsumed': a_consumed[0]},
                {'id': 'A-PACKAGE', 'configuredEndpoint': 'index', 'request': {'method': 'POST', 'url': config['index'],
                 'headers': {'content-type': 'application/json', 'accept': 'application/json'}, 'bodyByteRef': request_ref},
                 'response': {'status': 200, 'tlsAuthenticated': True, 'bodyByteRef': offered_ref}, 'expectedConsumed': a_consumed[1]}],
                'selectedTxtByteRef': blob(selected_txt, 'utf8-txt'), 'rootByteRef': root_ref,
                'literalSelectedTtlExpiry': root_valid_until,
                'producerHandoffByteRef': produced, 'handoffDelivered': b_input is not None},
            'B': {'consumerHandoffByteRef': b_input, 'initialStateByteRef': state_refs[0],
                'declaredSlices': [{'id': 'B-LOG-1', 'inputStateByteRef': state_refs[0], 'outputStateByteRef': state_refs[1]},
                    {'id': 'B-LOG-2', 'inputStateByteRef': step2_input, 'outputStateByteRef': state_refs[2]},
                    {'id': 'B-LOG-3', 'inputStateByteRef': state_refs[2], 'outputStateByteRef': state_refs[3]}],
                'expectedOutgoingRequests': [], 'literalFinalOutputByteRef': output_ref},
            'byteBindings': {'offeredPackageByteRef': package_ref, 'sortedPublicRecordsByteRef': blob(sorted_keys),
                'manifestPayloadByteRef': blob(manifest_payload), 'stableTargetByteRef': blob(target),
                'didPublicJwkByteRef': blob(did_jwk),
                'previousHashMatches': [True, True, False] if ident == 'AB-STATIC-07' else [True, True, True]},
            'resourceFacts': {'sharedContextByteRef': blob(context), 'acquisitionElapsedMs': a_times,
                'acquisitionAdmittedElapsedMs': a_admitted_times,
                'countedBodyByteRefs': [dns_ref] if ident == 'AB-STATIC-02' else [dns_ref, offered_ref],
                'verificationProposedElapsedMs': b_times, 'signatureAttemptsRequested': 5,
                'verificationTimeline': [{'boundary': name, 'elapsedMs': elapsed} for name, elapsed in
                    ([('B-BINDINGS', 6000), ('B-LOG-1', 9999), ('BEFORE-B-LOG-2', 10000)] if ident == 'AB-STATIC-05'
                     else [('B-BINDINGS', 300), ('B-LOG-1', 800), ('B-LOG-2', 1300), ('B-LOG-3', 1800), ('B-PROMOTION', 2100)])],
                'deadlineResetAllowed': False, 'networkInVerification': 0},
            'signatures': evidence, 'comparisons': comparisons, 'mathematicalFacts': facts, 'expected': expected}
        name = ident.lower()+'.json'
        files[name] = fixture
        coverage.append({'id': ident, 'file': name, 'variant': variant, 'expected': expected, 'contracts': contracts})
    files['materials.json'] = {'format': 'ltp-frozen-byte-materials', 'soloPruebas': True, 'materials': materials}
    files['coverage.json'] = {'format': 'ltp-composed-coverage', 'version': '0.3', 'scope': 'G1 review only', 'cases': coverage}
    previous = json.loads((PRIOR / 'manifest.json').read_text())
    inherited = [{'file': os.path.relpath((PRIOR / item['file']).resolve(), OUT), 'digest': item['digest']} for item in previous['fixtures']]
    files['manifest.json'] = {'format': 'ltp-total-conformance-candidate', 'version': '0.3', 'status': 'pending-owner-review',
        'scope': 'G1 only; no implementation authorization', 'previousCorpusDigest': digest(previous),
        'originalCorpusDigest': previous['originalCorpusDigest'], 'schemaBundleDigest': previous['schemaBundleDigest'],
        'numericExtensionDigest': previous['numericExtensionDigest'],
        'fixtures': inherited + [{'file': '../v0.2/manifest.json', 'digest': digest(previous)}]
            + [{'file': name, 'digest': digest(value)} for name, value in sorted(files.items())],
        'composedCases': 7, 'inheritedTargets': 362, 'totalTargets': 369}
    return files


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true')
    p.add_argument('--publish', action='store_true')
    args = p.parse_args()
    files = assemble()
    if args.publish:
        assert OUT.is_dir()
        for name, value in files.items():
            path = OUT / name
            if path.exists():
                assert json.loads(path.read_text()) == value, 'Refusing to replace static candidate: '+name
        for name, value in files.items():
            path = OUT / name
            if not path.exists():
                path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf8')
    if args.check:
        for name, value in files.items():
            assert json.loads((OUT/name).read_text()) == value, 'Frozen composed asset differs: '+name
    print(json.dumps({'candidateDigest': digest(files['manifest.json']), 'cases': 7, 'totalTargets': 369,
                     'materials': len(files['materials.json']['materials']), 'workflowExecuted': False}))
