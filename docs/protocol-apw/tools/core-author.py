#!/usr/bin/env python3
"""CC BY 4.0. Static candidate compiler, NOT a verifier/transport/budget engine.

Expected decisions below are authored literals. Cryptography is used only to
precalculate TEST signatures. --check never rewrites expectations; --publish
creates new candidate assets and refuses to replace differing existing files.
"""
import argparse
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

SPEC = Path(__file__).resolve().parent.parent
OLD = SPEC / "vectors/ltp/v0.1"
OUT = SPEC / "vectors/ltp/v0.2"
sys.path.insert(0, str(OLD / "tools"))
from author import canonical, b64, unb64, digest, sha

NOW = 1790000000
DID = "did:apw:core.vector.example"
BOOT = "../../../APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md"
PACK = "../../../LTP-PROOF-PACKAGE-DRAFT-v0.1.md"
SER = "../../../LTP-SERIALIZATION-DRAFT-v0.1.md"
APW = "../../../APW-SPEC-v1.3.md"
INDEX = "../../../LTP-INDEX-DRAFT-v0.1.md"
LIMITS = "../../../../architecture/resolution-chain-proposal.md#approved-resource-limits"
DROP = object()


def stamp(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def produce():
    signatures = {}
    keys = []
    for i in range(3):
        seed = sha(f"solo pruebas LTP S3-core 0.2 key {i + 1}".encode())
        key = Ed25519PrivateKey.from_private_bytes(seed)
        jwk = {"kty": "OKP", "crv": "Ed25519", "x": b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))}
        keys.append((key, jwk, f"{DID}#key-{i+1}"))
    capacity_methods = []
    for i in range(49):
        key = Ed25519PrivateKey.from_private_bytes(sha(f"solo pruebas capacity public method {i}".encode()))
        jwk = {"kty": "OKP", "crv": "Ed25519", "x": b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))}
        capacity_methods.append({"id": f"{DID}#key-{1001+i}", "type": "JsonWebKey2020", "controller": DID, "publicKeyJwk": jwk})

    def sign(payload, index, typ, kid=None, alg="EdDSA", valid=True):
        key, jwk, normal_kid = keys[index]
        header = canonical({"alg": alg, "kid": kid or normal_kid, "typ": typ})
        message = (b64(header.encode()) + "." + b64(canonical(payload).encode())).encode()
        signature = bytearray(key.sign(message))
        if not valid:
            signature[0] ^= 1
        wire = message + b"." + b64(bytes(signature)).encode()
        ref = b64(sha(wire))
        signatures[ref] = {"wireHex": wire.hex(), "publicJwk": jwk, "signatureValid": valid,
                           "joseAccepted": valid and alg == "EdDSA", "signingInputDigest": b64(sha(message)),
                           "payloadDigest": b64(sha(canonical(payload).encode())), "soloPruebas": True}
        return {"$jws": ref}

    def wire(ref):
        return bytes.fromhex(signatures[ref["$jws"]]["wireHex"])

    def expand(value):
        if isinstance(value, dict):
            if set(value) == {"$jws"}:
                return wire(value).decode()
            return {k: expand(v) for k, v in value.items()}
        if isinstance(value, list):
            return [expand(v) for v in value]
        return value

    def commit(value):
        return digest(expand(value))

    def payload(ref):
        return json.loads(unb64(wire(ref).decode().split(".")[1]))

    def repair(obj):
        p = obj["result"]["package"]
        if p is not None:
            for history in p["histories"]:
                old = history.pop("id", None)
                history["id"] = commit(history)
                for identity in p["identities"]:
                    if identity["historyRef"] == old:
                        identity["historyRef"] = history["id"]
            obj["result"]["packageDigest"] = commit(p)
        else:
            obj["result"]["packageDigest"] = None
        obj["local"]["policyDigest"] = digest(obj["local"]["policy"])
        response = obj["transport"]["response"]
        response["bodyUtf8"] = canonical(response["json"])
        response["bodyDigest"] = b64(sha(response["bodyUtf8"].encode()))

    def build(count, rotation=False, legacy=False, first_timestamp=None):
        current = 2 if rotation else 0
        windows = [(NOW - 3000, NOW - 1667), (NOW - 1667, NOW - 1334), (NOW - 1334, None)] if rotation else [(NOW - 3000, None)]
        records = [{"keyId": None if legacy and i == 0 else keys[i][2], "fingerprint": digest(keys[i][1]),
                    "publicKeyJwk": keys[i][1], "validFrom": stamp(start), "validTo": stamp(end) if end else None}
                   for i, (start, end) in enumerate(windows)]
        entries, previous = [], None
        for i in range(count):
            t = NOW - 2000 + i
            signing = (0 if i < 334 else 1 if i < 667 else 2) if rotation and count == 1000 else (0 if i == 0 else 1 if i == 1 else 2) if rotation else 0
            if rotation and count != 1000:
                t = [NOW - 1700, NOW - 1500, NOW - 1000][min(i, 2)] + max(i - 2, 0)
            if i == 0 and first_timestamp is not None:
                t = first_timestamp
            source = sign({"typ": "apw-attestation+jws", "iss": DID, "sub": DID, "src": "self", "cat": "core-fixture",
                           "val": True, "iat": t, "jti": f"solo-pruebas-core-{count}-{i+1}"}, signing, "apw-attestation+jws")
            kid = records[0]["fingerprint"] if legacy and signing == 0 else None
            entry = sign({"seq": i+1, "prev": previous, "att": b64(sha(wire(source))), "ts": stamp(t)}, signing, "apw-log+jws", kid=kid)
            entries.append({"seq": i+1, "jws": entry})
            previous = b64(sha(wire(entry)))
        terminal = {"seq": count, "hash": previous}
        sorted_records = sorted(records, key=lambda r: (r["fingerprint"], r["keyId"] or ""))
        keyset = sign({"version": "0.1", "did": DID, "keysDigest": digest(sorted_records), "terminal": terminal,
                       "iat": NOW, "exp": NOW+60}, current, "apw-key-set+jws")
        txt = {"v": 2, "siteId": "core.vector.example", "trustUrl": "/trust/core.vector.example", "contentKinds": ["mixed"],
               "k": digest(keys[current][1]), "rg": False}
        if previous:
            txt["h"] = previous
        manifest = sign({**txt, "did": DID, "iat": NOW}, current, "apw-manifest+jws")
        history = {"did": DID, "format": "full", "checkpointRef": None, "startSeq": 1, "keys": records,
                   "keySetJws": keyset, "entries": entries, "terminal": terminal}
        history["id"] = commit(history)
        p = {"typ": "ltp-proof-package", "version": "0.1", "profile": "apw-identity-proof-v1", "subject": DID,
             "bootstrapProfile": "independent-doh-ad-v1", "identities": [{"did": DID, "didDocument": {"id": DID,
                "verificationMethod": [{"id": keys[current][2], "type": "JsonWebKey2020", "controller": DID, "publicKeyJwk": keys[current][1]}]},
                "manifestJws": manifest, "dnsMessages": [], "historyRef": history["id"]}],
             "histories": [history], "attestations": [], "issuerBindings": [], "calculation": None, "assembledAt": NOW, "expiresAt": NOW+60}
        request = {"typ": "ltp-resolution-request", "version": "0.1", "requestId": b64(sha(b"solo pruebas core request")),
                   "subject": DID, "profile": p["profile"], "bootstrapProfile": p["bootstrapProfile"], "checkpointIds": [], "resume": [],
                   "limits": {"maxPackageBytes": 524288, "maxSignatureVerifications": 640, "deadlineMs": 10000}}
        dns_json = {"Status": 0, "TC": False, "AD": True, "Question": [{"name": "_apw.core.vector.example.", "type": 16}],
                    "Answer": [{"name": "_apw.core.vector.example.", "type": 16, "TTL": 60, "data": json.dumps(canonical(txt), ensure_ascii=False)}]}
        obj = {"request": request, "result": {"typ": "ltp-resolution-result", "version": "0.1", "requestId": request["requestId"],
               "subject": DID, "profile": p["profile"], "bootstrapProfile": p["bootstrapProfile"], "status": "candidate",
               "package": p, "packageDigest": commit(p), "reason": None, "retryAfterSeconds": None},
               "local": {"now": NOW+10, "policy": {"rulesVersion": "core-fixture-0.2", "clockSkewSeconds": 0,
                  "maxSnapshotAgeSeconds": 60, "resolverIds": ["operator-primary"], "fallbackOnTransportFailure": False},
                  "policyDigest": "", "checkpoints": [], "quarantined": None,
                  "onlineObservation": {"channel": "consumer-https-fixture", "resolverId": "operator-primary", "receivedAt": NOW,
                     "validUntil": NOW+60, "question": "_apw.core.vector.example", "AD": True, "TC": False, "Status": 0, "manifest": txt},
                  "resourceGrant": False},
               "transport": {"inputDomain": "core.vector.example", "configuredEndpoints": ["https://resolver.fixture.invalid/dns-query"],
                  "request": {"method": "GET", "url": "https://resolver.fixture.invalid/dns-query?name=_apw.core.vector.example&type=TXT&do=1&cd=0"},
                  "response": {"http": 200, "tlsAuthenticated": True, "resolverId": "operator-primary", "json": dns_json, "bodyUtf8": "", "bodyDigest": ""}}}
        repair(obj)
        return obj

    proofs = {"identity-single": build(2), "identity-empty": build(0), "identity-rotation": build(3, True),
              "identity-legacy": build(3, True, True), "identity-1000": build(1000, True),
              "window-start": build(3, True, first_timestamp=NOW-3000),
              "window-end": build(3, True, first_timestamp=NOW-1667),
              "window-before": build(3, True, first_timestamp=NOW-3001),
              "window-after": build(3, True, first_timestamp=NOW-1666)}
    cases = {f"CORE-0{i}": [] for i in range(1, 7)}

    def set_path(obj, path, value):
        parts = path.strip("/").split("/")
        parent = obj
        for part in parts[:-1]:
            parent = parent[int(part)] if isinstance(parent, list) else parent[part]
        key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
        if value is DROP:
            parent.pop(key)
        else:
            parent[key] = copy.deepcopy(value)

    def diff(a, b, path=""):
        if a == b:
            return []
        if isinstance(a, dict) and isinstance(b, dict):
            return ([{"op": "remove", "path": path + "/" + k} for k in a if k not in b]
                    + [{"op": "add", "path": path + "/" + k, "value": v} for k, v in b.items() if k not in a]
                    + [op for k in a if k in b for op in diff(a[k], b[k], path + "/" + k)])
        if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
            return [op for i in range(len(a)) for op in diff(a[i], b[i], path + "/" + str(i))]
        return [{"op": "replace", "path": path, "value": b}]

    def case(area, suffix, reason, changes=None, base="identity-single", stage="bootstrap", accepted=False,
             schema=True, request_schema=True, contract=None, extra=None, repair_digest=True):
        obj = copy.deepcopy(proofs[base])
        for path, value in (changes or {}).items():
            set_path(obj, path, value)
        if repair_digest:
            repair(obj)
        expected = {"proofAccepted": accepted, "stage": stage, "reason": reason, "resourceGrant": False,
                    "reputationAdmitted": False, "requestSchemaValid": request_schema, "resultSchemaValid": schema,
                    "arbitraryOriginCalls": 0, "misconduct": False}
        expected.update(extra or {})
        targets = {"CORE-01": "bootstrap-local-context", "CORE-02": "doh-transcript", "CORE-03": "identity-proof",
                   "CORE-04": "history-proof", "CORE-05": "service-or-parser", "CORE-06": "resource-objective"}
        value = {"id": area + "-" + suffix, "area": area, "contracts": contract or [BOOT + "#3-profile-independent-doh-ad-v1"],
                 "input": {"target": targets[area], "base": base, "patch": diff(proofs[base], obj)}, "expected": expected}
        cases[area].append(value)
        return value

    # CORE-01: independently provisioned identity roots, policy and time.
    case("CORE-01", "valid-root", None, accepted=True, stage="complete")
    for suffix, changes, reason in [
        ("forwarded-ad", {"/local/onlineObservation": None}, "bootstrap_incomplete"),
        ("ad-false", {"/local/onlineObservation/AD": False}, "dnssec_required"),
        ("ad-absent", {"/local/onlineObservation/AD": DROP}, "dnssec_required"),
        ("resolver-substitution", {"/local/onlineObservation/resolverId": "index-nominated"}, "bootstrap_invalid"),
        ("root-key-substitution", {"/local/onlineObservation/manifest/k": digest(keys[1][1])}, "key_mismatch"),
        ("expired-root", {"/local/now": NOW+60}, "freshness_unproven"),
        ("future-observation", {"/local/onlineObservation/receivedAt": NOW+11}, "bootstrap_invalid"),
        ("unsupported-profile", {"/request/bootstrapProfile": "provider-trusted-v1"}, "bootstrap_unsupported"),
        ("package-policy-install", {"/result/package/trustPolicy": {"requireAD": False}}, "schema_invalid"),
        ("package-anchor-install", {"/result/package/trustAnchors": [keys[1][1]]}, "schema_invalid"),
    ]:
        case("CORE-01", suffix, reason, changes, schema=not suffix.startswith("package-"), request_schema=suffix != "unsupported-profile")
    case("CORE-01", "ttl-before-expiry", None, {"/local/now": NOW+59}, accepted=True, stage="complete")
    case("CORE-01", "known-sequence-rollback", "anchor_mismatch", {"/local/knownHead": {"seq": 3, "hash": b64(sha(b"known newer head"))}}, stage="history", contract=[PACK+"#5-historyproof-completeness-and-checkpoints"])
    case("CORE-01", "known-sequence-equivocation", "anchor_mismatch", {"/local/knownHead": {"seq": 2, "hash": b64(sha(b"different head at same seq"))}}, stage="history", contract=[PACK+"#5-historyproof-completeness-and-checkpoints"])

    # CORE-02: literal DoH transcripts; never execute these requests.
    dns = "/transport/response/json"
    for suffix, changes, reason in [
        ("valid-txt", {}, None),
        ("wrong-question", {dns+"/Question/0/name": "_apw.other.example."}, "bootstrap_invalid"),
        ("wrong-question-type", {dns+"/Question/0/type": 1}, "bootstrap_invalid"),
        ("wrong-answer-owner", {dns+"/Answer/0/name": "_apw.other.example."}, "bootstrap_invalid"),
        ("wrong-answer-type", {dns+"/Answer/0/type": 1}, "bootstrap_invalid"),
        ("truncated", {dns+"/TC": True}, "bootstrap_invalid"),
        ("ad-absent", {dns+"/AD": DROP}, "dnssec_required"),
        ("ad-false", {dns+"/AD": False}, "dnssec_required"),
        ("ad-string", {dns+"/AD": "true"}, "bootstrap_invalid"),
        ("tc-absent", {dns+"/TC": DROP}, "bootstrap_invalid"),
        ("servfail", {dns+"/Status": 2, dns+"/Answer": []}, "bootstrap_invalid"),
        ("nxdomain", {dns+"/Status": 3, dns+"/Answer": []}, "identity_not_found"),
        ("no-txt", {dns+"/Answer": []}, "identity_not_found"),
        ("ttl-negative", {dns+"/Answer/0/TTL": -1}, "bootstrap_invalid"),
        ("ttl-fractional", {dns+"/Answer/0/TTL": 0.5}, "bootstrap_invalid"),
        ("ttl-zero", {dns+"/Answer/0/TTL": 0}, "freshness_unproven"),
        ("tls-untrusted", {"/transport/response/tlsAuthenticated": False}, "transport_unavailable"),
        ("redirect", {"/transport/response/http": 302, "/transport/response/location": "https://subject.invalid/private"}, "redirect_denied"),
        ("http-unavailable", {"/transport/response/http": 503}, "transport_unavailable"),
        ("cname", {dns+"/Answer/0/type": 5}, "bootstrap_unsupported"),
        ("dname", {dns+"/Answer/0/type": 39}, "bootstrap_unsupported"),
    ]:
        case("CORE-02", suffix, reason, changes, accepted=reason is None, stage="complete" if reason is None else "bootstrap",
             extra={"expectedHttp": 401, "retryAfter": None} if suffix == "redirect" else None,
             contract=[BOOT+"#2-shared-parsing-and-binding-rules", BOOT+"#3-profile-independent-doh-ad-v1"])
    answer = copy.deepcopy(proofs["identity-single"]["transport"]["response"]["json"]["Answer"][0])
    txt = copy.deepcopy(proofs["identity-single"]["local"]["onlineObservation"]["manifest"])
    alternative = {**answer, "data": json.dumps(canonical({**txt, "k": digest(keys[1][1])}), ensure_ascii=False)}
    case("CORE-02", "conflicting-txt", "bootstrap_ambiguous", {dns+"/Answer": [answer, alternative]}, contract=[BOOT+"#2-shared-parsing-and-binding-rules"])
    case("CORE-02", "conflicting-txt-reversed", "bootstrap_ambiguous", {dns+"/Answer": [alternative, answer]}, contract=[BOOT+"#2-shared-parsing-and-binding-rules"])
    case("CORE-02", "duplicate-identical-txt", None, {dns+"/Answer": [answer, answer]}, accepted=True, stage="complete", contract=[BOOT+"#2-shared-parsing-and-binding-rules"])
    text = canonical(txt)
    case("CORE-02", "split-txt-strings", None, {dns+"/Answer/0/data": json.dumps(text[:80])+" "+json.dumps(text[80:])}, accepted=True, stage="complete", contract=[BOOT+"#2-shared-parsing-and-binding-rules"])
    for suffix, domain in [("uppercase", "Core.example"), ("trailing-dot", "core.example."), ("url-input", "https://core.example"), ("userinfo", "a@core.example"), ("port", "core.example:443"), ("fragment", "core.example#x"), ("unicode", "café.example"), ("fqdn-too-long", ".".join(["a"*63]*4))]:
        case("CORE-02", "domain-"+suffix, "bootstrap_invalid", {"/transport/inputDomain": domain}, extra={"expectedTransportCalls": 0}, contract=[BOOT+"#2-shared-parsing-and-binding-rules"])
    for suffix, endpoint in [("http", "http://resolver.fixture.invalid/dns-query"), ("private", "https://127.0.0.1/dns-query"), ("credentials", "https://user:solo-pruebas@resolver.fixture.invalid/dns-query"), ("fragment", "https://resolver.fixture.invalid/dns-query#x"), ("query", "https://resolver.fixture.invalid/dns-query?upstream=attacker")]:
        case("CORE-02", "endpoint-"+suffix, "bootstrap_unsupported", {"/transport/configuredEndpoints": [endpoint]}, extra={"expectedTransportCalls": 0})
    for suffix, primary, reason, attempts in [("transport-fallback", "transport_failure", None, 2), ("no-downgrade", "AD_false", "dnssec_required", 1), ("ambiguous-no-fallback", "ambiguous_txt", "bootstrap_ambiguous", 1), ("transport-no-fallback", "transport_failure", "transport_unavailable", 1)]:
        primary_response = copy.deepcopy(proofs["identity-single"]["transport"]["response"])
        if primary == "AD_false":
            primary_response["json"]["AD"] = False
        if primary == "ambiguous_txt":
            primary_response["json"]["Answer"] = [answer, alternative]
        primary_response["bodyUtf8"] = canonical(primary_response["json"])
        primary_response["bodyDigest"] = b64(sha(primary_response["bodyUtf8"].encode()))
        primary_attempt = {"request": proofs["identity-single"]["transport"]["request"],
                           "response": None if primary == "transport_failure" else primary_response,
                           "error": "transport_failure" if primary == "transport_failure" else None}
        changes = {"/transport/attempts": [primary_attempt], "/local/policy/fallbackOnTransportFailure": suffix == "transport-fallback",
             "/local/policy/resolverIds": ["operator-primary", "operator-backup"],
             "/transport/configuredEndpoints": ["https://resolver.fixture.invalid/dns-query", "https://backup.fixture.invalid/dns-query"]}
        if attempts == 2:
            second_response = copy.deepcopy(proofs["identity-single"]["transport"]["response"])
            second_response["resolverId"] = "operator-backup"
            changes["/transport/attempts"].append({"request": {"method": "GET", "url": "https://backup.fixture.invalid/dns-query?name=_apw.core.vector.example&type=TXT&do=1&cd=0"}, "response": second_response, "error": None})
        case("CORE-02", suffix, reason, changes,
             accepted=reason is None, stage="complete" if reason is None else "bootstrap", extra={"expectedTransportCalls": attempts, "sameBudget": True})

    # CORE-03: DID, active key and signed manifest binding.
    d = "/result/package/identities/0/didDocument"
    m = d+"/verificationMethod/0"
    for suffix, changes, reason, schema in [
        ("valid-did", {}, None, True),
        ("document-subject", {d+"/id": "did:apw:other.example"}, "key_mismatch", True),
        ("controller", {m+"/controller": "did:apw:other.example"}, "key_mismatch", True),
        ("method-kid", {m+"/id": DID+"#key-99"}, "key_mismatch", True),
        ("public-key-substitution", {m+"/publicKeyJwk": keys[1][1]}, "key_mismatch", True),
        ("private-key", {m+"/publicKeyJwk/d": b64(sha(b"solo pruebas private JWK rejection"))}, "schema_invalid", False),
        ("unsupported-key", {m+"/publicKeyJwk/crv": "X25519"}, "schema_invalid", False),
        ("missing-methods", {d+"/verificationMethod": []}, "schema_invalid", False),
        ("missing-document-id", {d+"/id": DROP}, "schema_invalid", False),
        ("history-reference", {"/result/package/identities/0/historyRef": b64(sha(b"missing history"))}, "proof_incomplete", True),
        ("identity-missing", {"/result/package/identities": []}, "schema_invalid", False),
        ("identity-duplicate", {"/result/package/identities": proofs["identity-single"]["result"]["package"]["identities"]*2}, "proof_incomplete", True),
        ("unused-identity", {"/result/package/identities": proofs["identity-single"]["result"]["package"]["identities"] + [{**proofs["identity-single"]["result"]["package"]["identities"][0], "did": "did:apw:unused.example"}]}, "proof_incomplete", True),
    ]:
        case("CORE-03", suffix, reason, changes, stage="complete" if reason is None else "identity", accepted=reason is None, schema=schema,
             contract=[PACK+"#4-identityproof-and-independent-roots", APW+"#51-didapw-resolution-closes-b1-and-b2"])
    method = proofs["identity-single"]["result"]["package"]["identities"][0]["didDocument"]["verificationMethod"][0]
    case("CORE-03", "duplicate-method", "key_mismatch", {d+"/verificationMethod": [method, method]}, stage="identity", contract=[PACK+"#4-identityproof-and-independent-roots"])
    case("CORE-03", "ambiguous-method", "key_mismatch", {d+"/verificationMethod": [method, {**method, "publicKeyJwk": keys[1][1]}]}, stage="identity", contract=[PACK+"#4-identityproof-and-independent-roots"])
    original_manifest = payload(proofs["identity-single"]["result"]["package"]["identities"][0]["manifestJws"])
    for suffix, p, alg, kid, typ, valid, reason in [
        ("signed-subject", {**original_manifest, "did": "did:apw:other.example"}, "EdDSA", None, "apw-manifest+jws", True, "key_mismatch"),
        ("signed-txt-fields", {**original_manifest, "trustUrl": "/different"}, "EdDSA", None, "apw-manifest+jws", True, "key_mismatch"),
        ("future-manifest", {**original_manifest, "iat": NOW+11}, "EdDSA", None, "apw-manifest+jws", True, "freshness_unproven"),
        ("stale-manifest", {**original_manifest, "iat": NOW-60}, "EdDSA", None, "apw-manifest+jws", True, "freshness_unproven"),
        ("unsupported-alg", original_manifest, "RS256", None, "apw-manifest+jws", True, "unsupported_algorithm"),
        ("foreign-kid", original_manifest, "EdDSA", "did:apw:other.example#key-1", "apw-manifest+jws", True, "key_mismatch"),
        ("wrong-typ", original_manifest, "EdDSA", None, "apw-log+jws", True, "unsupported_profile"),
        ("bad-signature", original_manifest, "EdDSA", None, "apw-manifest+jws", False, "bad_signature"),
    ]:
        case("CORE-03", suffix, reason, {"/result/package/identities/0/manifestJws": sign(p, 0, typ, kid=kid, alg=alg, valid=valid)}, stage="identity", contract=[PACK+"#4-identityproof-and-independent-roots"])

    # CORE-04: signed multi-key histories and literal resumable state.
    history_ref = PACK+"#5-historyproof-completeness-and-checkpoints"
    h = "/result/package/histories/0"
    for suffix, base in [("rotation-valid", "identity-rotation"), ("legacy-fingerprint-kid", "identity-legacy"), ("empty-history", "identity-empty")]:
        case("CORE-04", suffix, None, base=base, stage="complete", accepted=True, contract=[history_ref])
    for suffix, base, reason, accepted in [("window-start-inclusive", "window-start", None, True),
        ("window-end-inclusive", "window-end", None, True), ("window-before-invalid", "window-before", "ts_outside_key_window", False),
        ("window-after-invalid", "window-after", "ts_outside_key_window", False)]:
        case("CORE-04", suffix, reason, base=base, stage="complete" if accepted else "history", accepted=accepted, contract=[history_ref, APW+"#54-chained-history-closes-b6"])
    rotation = proofs["identity-rotation"]["result"]["package"]["histories"][0]
    case("CORE-04", "keys-reversed", None, {h+"/keys": rotation["keys"][::-1]}, base="identity-rotation", stage="complete", accepted=True, contract=[history_ref, SER+"#3-canonical-serialization-and-hash-ledger"])
    for suffix, changes, reason in [
        ("duplicate-key", {h+"/keys": rotation["keys"]+[rotation["keys"][0]]}, "key_kid_mismatch"),
        ("key-id-alias", {h+"/keys/0/keyId": keys[1][2]}, "key_kid_mismatch"),
        ("fingerprint-substitution", {h+"/keys/0/fingerprint": digest(keys[1][1])}, "key_kid_mismatch"),
        ("unsigned-window-extension", {h+"/keys/0/validTo": stamp(NOW)}, "keys_digest_mismatch"),
        ("missing-historical-key", {h+"/keys": rotation["keys"][1:]}, "keys_digest_mismatch"),
        ("target-terminal-mismatch", {h+"/terminal/hash": b64(sha(b"wrong terminal"))}, "key_set_binding_mismatch"),
        ("truncated-prefix", {h+"/entries": rotation["entries"][:1]}, "proof_incomplete"),
        ("unknown-checkpoint", {h+"/format": "continuation", h+"/checkpointRef": b64(sha(b"unknown checkpoint")), h+"/startSeq": 2, h+"/entries": rotation["entries"][1:]}, "checkpoint_required"),
    ]:
        case("CORE-04", suffix, reason, changes, base="identity-rotation", stage="history", contract=[history_ref])
    for suffix, fields, kid, signing, valid, reason in [
        ("seq-gap", {"seq": 3}, None, 1, True, "seq_gap"),
        ("prev-mutation", {"prev": b64(sha(b"wrong prev"))}, None, 1, True, "prev_mismatch"),
        ("timestamp-regression", {"ts": stamp(NOW-1800)}, None, 1, True, "ts_outside_key_window"),
        ("unknown-signing-kid", {}, DID+"#key-99", 1, True, "unknown_key"),
        ("foreign-signing-kid", {}, "did:apw:other.example#key-2", 1, True, "key_kid_mismatch"),
        ("log-bad-signature", {}, None, 1, False, "bad_signature"),
    ]:
        changed = {**payload(rotation["entries"][1]["jws"]), **fields}
        case("CORE-04", suffix, reason, {h+"/entries/1/jws": sign(changed, signing, "apw-log+jws", kid=kid, valid=valid), h+"/entries/1/seq": changed["seq"]}, base="identity-rotation", stage="history", contract=[history_ref])
    for suffix, fields, reason in [("binding-expired", {"exp": NOW+10}, "key_set_expired"), ("binding-future", {"iat": NOW+11}, "freshness_unproven"), ("binding-invalid-interval", {"exp": NOW}, "key_set_expired"), ("binding-wrong-keyset", {"keysDigest": b64(sha(b"wrong set"))}, "keys_digest_mismatch")]:
        binding = {**payload(rotation["keySetJws"]), **fields}
        case("CORE-04", suffix, reason, {h+"/keySetJws": sign(binding, 2, "apw-key-set+jws")}, base="identity-rotation", stage="key-set", contract=[history_ref, SER+"#3-canonical-serialization-and-hash-ledger"])
    single_history = proofs["identity-single"]["result"]["package"]["histories"][0]
    regressed = {**payload(single_history["entries"][1]["jws"]), "ts": stamp(NOW-2001)}
    case("CORE-04", "ts-regression-within-window", "ts_regression", {h+"/entries/1/jws": sign(regressed, 0, "apw-log+jws")}, stage="history", contract=[history_ref, APW+"#54-chained-history-closes-b6"])
    case("CORE-04", "dns-anchor-not-in-chain", "head_mismatch", {"/local/onlineObservation/manifest/h": b64(sha(b"missing DNS anchor"))}, stage="history", contract=[history_ref])
    case("CORE-04", "signed-head-extends-dns-anchor", None, {"/local/onlineObservation/manifest/h": b64(sha(wire(rotation["entries"][0]["jws"])))},
         base="identity-rotation", stage="complete", accepted=True, contract=[history_ref, APW+"#52-site-artifact-signing-closes-b3"], extra={"unanchoredEntries": 2})
    long = proofs["identity-1000"]
    lh = long["result"]["package"]["histories"][0]
    sorted_keys = sorted(lh["keys"], key=lambda r: (r["fingerprint"], r["keyId"] or ""))
    manifest_core = payload(long["result"]["package"]["identities"][0]["manifestJws"])
    manifest_core.pop("iat")
    def resume(seq):
        return {"did": DID, "targetManifestDigest": digest(manifest_core), "rootManifestDigest": digest(long["local"]["onlineObservation"]["manifest"]),
                "keySetDigest": digest(sorted_keys), "nextSeq": seq+1, "previousHash": b64(sha(wire(lh["entries"][seq-1]["jws"])))}
    def progress(seq):
        return {"resume": resume(seq), "previousTimestamp": payload(lh["entries"][seq-1]["jws"])["ts"], "validUntil": NOW+60,
                "verifiedPrefixEntries": seq, "trustPolicyDigest": long["local"]["policyDigest"],
                "bootstrapProfile": "independent-doh-ad-v1", "rulesVersion": "core-fixture-0.2"}
    checkpoint_core = {"did": DID, "seq": 400, "hash": resume(400)["previousHash"],
        "previousTimestamp": payload(lh["entries"][399]["jws"])["ts"], "keys": sorted_keys, "keySetDigest": digest(sorted_keys),
        "rootManifestDigest": digest(long["local"]["onlineObservation"]["manifest"]), "bootstrapProfile": "independent-doh-ad-v1",
        "trustPolicyDigest": long["local"]["policyDigest"], "rulesVersion": "core-fixture-0.2", "sourceStateDigest": None}
    checkpoint = {"id": digest(checkpoint_core), "core": checkpoint_core, "retainedUntil": NOW+86400, "validUntil": NOW+60, "sources": None}
    continuation = {h+"/format": "continuation", h+"/checkpointRef": checkpoint["id"], h+"/startSeq": 401,
        h+"/entries": lh["entries"][400:800], "/request/checkpointIds": [checkpoint["id"]], "/local/checkpoints": [checkpoint],
        "/result/status": "incomplete", "/result/reason": "history_step_limit", "/result/retryAfterSeconds": 1}
    case("CORE-04", "trusted-continuation-pending", "history_step_limit", continuation, base="identity-1000", stage="history", contract=[history_ref], extra={"verifiedThrough": 800, "trustedCheckpointUsed": True})
    for suffix, mutated in [("checkpoint-expired", {**checkpoint, "retainedUntil": NOW+10}),
        ("checkpoint-policy-change", {**checkpoint, "core": {**checkpoint_core, "trustPolicyDigest": digest({"old": True})}}),
        ("checkpoint-root-change", {**checkpoint, "core": {**checkpoint_core, "rootManifestDigest": b64(sha(b"old root"))}}),
        ("checkpoint-keyset-change", {**checkpoint, "core": {**checkpoint_core, "keySetDigest": b64(sha(b"old key set"))}})]:
        changed = copy.deepcopy(continuation)
        mutated["id"] = digest(mutated["core"])
        changed[h+"/checkpointRef"] = mutated["id"]
        changed["/request/checkpointIds"] = [mutated["id"]]
        changed["/local/checkpoints"] = [mutated]
        case("CORE-04", suffix, "checkpoint_required", changed, base="identity-1000", stage="checkpoint", contract=[history_ref])
    for number, start, end in [(1, 0, 400), (2, 400, 800), (3, 800, 1000)]:
        changes = {h+"/format": "bootstrap-segment", h+"/startSeq": start+1, h+"/entries": lh["entries"][start:end]}
        if start:
            changes["/request/resume"] = [resume(start)]
            changes["/local/quarantined"] = progress(start)
        if end != 1000:
            changes.update({"/result/status": "incomplete", "/result/reason": "history_step_limit", "/result/retryAfterSeconds": 1})
        case("CORE-04", f"long-1000-step-{number}", None if end == 1000 else "history_step_limit", changes, base="identity-1000", stage="complete" if end == 1000 else "history",
             accepted=end == 1000, contract=[history_ref], extra={"verifiedThrough": end, "resume": resume(end) if end != 1000 else None,
               "normalQuotaRequest": number, "sharedClientWindow": "same-test-window", "expectedClientAttemptsUsed": [10, 20, 26][number-1]})
    # State substitutions use fully signed original slices, not forged log bytes.
    for suffix, context_patch in [
        ("resume-untrusted-prefix", {"/local/quarantined": None}),
        ("resume-target-change", {"/local/quarantined/resume/targetManifestDigest": b64(sha(b"other target"))}),
        ("resume-overlap", {h+"/startSeq": 400}),
        ("resume-expired", {"/local/quarantined/validUntil": NOW+10}),
        ("resume-policy-change", {"/local/quarantined/trustPolicyDigest": digest({"different": True})}),
        ("resume-rules-change", {"/local/quarantined/rulesVersion": "other-rules"}),
        ("resume-keyset-change", {"/local/quarantined/resume/keySetDigest": b64(sha(b"other keyset"))}),
        ("resume-root-change", {"/local/quarantined/resume/rootManifestDigest": b64(sha(b"other root"))}),
    ]:
        changes = {h+"/format": "bootstrap-segment", h+"/startSeq": 401, h+"/entries": lh["entries"][400:800], "/request/resume": [resume(400)],
                   "/local/quarantined": progress(400)}
        changes.update(context_patch)
        case("CORE-04", suffix, "checkpoint_required", changes, base="identity-1000", stage="checkpoint", contract=[history_ref])
    case("CORE-04", "restart-at-genesis", "history_step_limit", {h+"/format": "bootstrap-segment", h+"/entries": lh["entries"][:400],
         "/local/discardedProgress": progress(400), "/result/status": "incomplete", "/result/reason": "history_step_limit", "/result/retryAfterSeconds": 1},
         base="identity-1000", stage="history", contract=[history_ref], extra={"verifiedThrough": 400, "restartFromGenesis": True})

    # CORE-05: all service reason classes, nulls, schema failures and raw parser targets.
    service_rows = [
        ("candidate", None, 200, None), ("incomplete", "proof_incomplete", 200, None),
        ("incomplete", "checkpoint_required", 200, 1), ("incomplete", "history_step_limit", 200, 1),
        ("no_data", "proof_not_available", 200, None), ("unsupported", "invalid_request", 400, None),
        ("unsupported", "unsupported_version", 400, None), ("unsupported", "unsupported_profile", 400, None),
        ("denied", "authentication_required", 401, None), ("denied", "access_denied", 403, None),
        ("unavailable", "service_unavailable", 503, 2), ("unavailable", "service_unavailable", 503, None),
        ("limit_exceeded", "budget_exhausted", 429, 3), ("limit_exceeded", "budget_exhausted", 503, 3),
        ("limit_exceeded", "request_too_large", 413, None), ("limit_exceeded", "response_limit_exceeded", 503, None),
        ("limit_exceeded", "deadline_exceeded", 503, 1),
    ]
    for i, (status, reason, http, retry) in enumerate(service_rows):
        changes = {"/result/status": status, "/result/reason": reason, "/result/retryAfterSeconds": retry}
        if status not in ("candidate", "incomplete"):
            changes["/result/package"] = None
        case("CORE-05", f"service-{i+1:02d}-{reason or 'candidate'}", reason, changes, stage="service", accepted=False,
             contract=[SER+"#6-result-nulls-reasons-and-http-mapping", INDEX+"#7-reasons-portability-and-implementation-isolation"],
             extra={"httpStatus": http, "httpHeaders": {} if retry is None else {"retry-after": str(retry)}})
    for suffix, changes, reason, request_ok, result_ok in [
        ("unknown-version", {"/request/version": "9.9"}, "unsupported_version", False, True),
        ("unknown-profile", {"/request/profile": "unknown-v9"}, "unsupported_profile", False, True),
        ("request-binding", {"/result/requestId": b64(sha(b"other request"))}, "request_binding_mismatch", True, True),
        ("subject-binding", {"/result/subject": "did:apw:other.example"}, "request_binding_mismatch", True, True),
        ("missing-null", {"/result/retryAfterSeconds": DROP}, "schema_invalid", True, False),
        ("string-null", {"/result/reason": "null"}, "schema_invalid", True, False),
        ("retry-zero", {"/result/retryAfterSeconds": 0}, "schema_invalid", True, False),
        ("unknown-field", {"/result/verified": True}, "schema_invalid", True, False),
        ("negative-limit", {"/request/limits/deadlineMs": -1}, "schema_invalid", False, True),
    ]:
        case("CORE-05", suffix, reason, changes, stage="envelope", schema=result_ok, request_schema=request_ok, contract=[SER+"#2-input-bytes-and-null-versus-absence"])
    case("CORE-05", "digest-mismatch", "digest_mismatch", {"/result/packageDigest": b64(sha(b"incorrect digest"))}, stage="envelope", repair_digest=False, contract=[SER+"#3-canonical-serialization-and-hash-ledger"])
    for suffix, raw in [("duplicate", b'{"a":1,"a":2}'), ("escaped-duplicate", b'{"a":1,"\\u0061":2}'), ("bom", b'\xef\xbb\xbf{}'),
                        ("invalid-utf8", b'{"a":"\xff"}'), ("surrogate", b'{"a":"\\ud800"}'), ("nan", b'{"a":NaN}'),
                        ("infinity", b'{"a":Infinity}'), ("unsafe-integer", b'{"a":9007199254740992}'), ("truncated-json", b'{"a":')]:
        value = case("CORE-05", "parser-"+suffix, "invalid_json", stage="parse", contract=[SER+"#2-input-bytes-and-null-versus-absence"])
        value["input"]["rawJsonHex"] = raw.hex()
        value["expected"]["httpStatus"] = 400
    for suffix, body in [("retry-leading-zero", "01"), ("retry-plus", "+1"), ("retry-null-token", "null")]:
        value = case("CORE-05", suffix, "invalid_request", stage="http", contract=[SER+"#6-result-nulls-reasons-and-http-mapping"])
        value["input"]["httpHeaders"] = {"retry-after": body}
        value["expected"]["httpHeadersAccepted"] = False

    # CORE-06: authored limit boundary tuples and operation objectives, never a scheduler.
    limits = {"fqdnCharacters": 253, "dnsAnswers": 8, "dohBytes": 65536, "txtBytes": 4096, "didBytes": 131072,
              "didMethods": 16, "historyPageEntries": 100, "historyPageBytes": 262144, "historyPages": 4,
              "historyEntries": 400, "historyDocumentKeys": 16, "resolutionDistinctKeys": 48,
              "signatureAttempts": 640, "httpAttempts": 24, "bodyBytes": 4194304, "individualBodyBytes": 524288,
              "activeTotal": 8, "activeClient": 4, "activeHost": 1, "clientWindowAttempts": 40,
              "clientWindowBytes": 16777216, "originWindowAttempts": 32, "originWindowBytes": 8388608,
              "quotaBuckets": 4096, "cacheHostsPerClass": 256, "progressStates": 64, "checkpoints": 256}
    for dimension, limit in limits.items():
        for boundary, amount, verdict, reason in [("below", limit-1, "accept", None), ("at", limit, "accept", None), ("over", limit+1, "reject", "limit_exceeded")]:
            value = case("CORE-06", f"{dimension}-{boundary}", reason, stage="resource-objective", contract=[LIMITS, PACK+"#8-acceptance-result-validity-and-privacy"])
            value["input"]["objective"] = {"dimension": dimension, "limit": limit, "amount": amount, "boundary": boundary, "kind": "capacity-after-admission"}
            if dimension == "fqdnCharacters":
                rest = amount-5
                labels = []
                while rest > 63:
                    labels.append("a"*63)
                    rest -= 64
                labels.append("a"*rest)
                value["input"]["objective"]["dnsName"] = "_apw."+".".join(labels)
            if dimension in ["dohBytes", "txtBytes", "didBytes", "historyPageBytes", "individualBodyBytes"]:
                prefix, suffix = b'{"soloPruebas":"', b'"}'
                repeats = amount-len(prefix)-len(suffix)
                value["input"]["objective"]["bodyRecipe"] = {"prefixHex": prefix.hex(), "unitHex": "61", "repeat": repeats,
                    "suffixHex": suffix.hex(), "bytes": amount, "sha256": b64(sha(prefix+b"a"*repeats+suffix))}
            if dimension in ["historyPageEntries", "historyEntries"]:
                value["input"]["objective"]["signedEntries"] = {"base": "identity-1000", "sliceStart": 0, "sliceEnd": amount}
            if dimension == "signatureAttempts":
                value["input"]["objective"]["signedAttemptRefs"] = [proofs["identity-single"]["result"]["package"]["histories"][0]["entries"][0]["jws"]]*amount
            if dimension in ["didMethods", "historyDocumentKeys", "resolutionDistinctKeys"]:
                value["input"]["objective"]["publicMethods"] = capacity_methods[:amount]
            value["expected"].update({"resourceDecision": verdict, "transportOrCryptoBeyondLimit": 0, "proofAccepted": False})
    for dimension, deadline, expired_reason in [("globalDeadlineMs", 10000, "deadline_exceeded"), ("hopDeadlineMs", 3000, "deadline_exceeded"), ("positiveCacheSeconds", 60, "freshness_unproven"), ("negativeCacheSeconds", 15, None), ("checkpointRetentionSeconds", 86400, "checkpoint_required"), ("quotaWindowSeconds", 60, None)]:
        for boundary, elapsed, decision in [("before", deadline-1, "valid"), ("at", deadline, "expired"), ("after", deadline+1, "expired")]:
            value = case("CORE-06", f"{dimension}-{boundary}", None if decision == "valid" else expired_reason, stage="resource-objective", contract=[LIMITS, BOOT+"#5-local-result-and-expiry"])
            value["input"]["objective"] = {"dimension": dimension, "deadline": deadline, "elapsed": elapsed, "boundary": boundary}
            value["expected"].update({"timeDecision": decision, "resourceGrant": False})
    objectives = [
        ("nested-shared-signatures", {"dimension": "signatureAttempts", "charges": [400, 200, 2, 38], "cap": 640}, {"requestedTotal": 640, "resourceDecision": "accept"}),
        ("failed-signatures-count", {"dimension": "signatureAttempts", "charges": [639, 1, 1], "cap": 640, "failedAttempts": 2}, {"requestedTotal": 641, "resourceDecision": "reject", "workBeyondCap": 0}),
        ("nested-shared-body", {"dimension": "bodyBytes", "charges": [2097152, 2097152, 1], "cap": 4194304}, {"requestedTotal": 4194305, "resourceDecision": "reject", "workBeyondCap": 0}),
        ("retry-does-not-reset", {"dimension": "httpAttempts", "charges": [23, 1, 1], "cap": 24}, {"requestedTotal": 25, "resourceDecision": "reject", "workBeyondCap": 0}),
        ("resume-same-window", {"dimension": "clientWindowAttempts", "charges": [10, 10, 6], "cap": 40}, {"requestedTotal": 26, "resourceDecision": "accept"}),
        ("cache-hit-no-ttl-slide", {"receivedAt": NOW, "ttlSeconds": 60, "hitsAt": [NOW+20, NOW+59]}, {"validUntil": NOW+60, "networkCalls": 0}),
        ("dependency-expiry-clamp", {"expiryBounds": [NOW+60, NOW+30, NOW+20, NOW+10]}, {"validUntil": NOW+10}),
        ("remaining-hop-deadline", {"remainingMs": 700, "hopCeilingMs": 3000}, {"hopAllowanceMs": 700}),
        ("abort-before-acquisition", {"abortedBeforeStart": True}, {"networkCalls": 0, "activePermitsAfter": 0}),
        ("abort-stream", {"bytesReceived": 4096, "abortedDuringBody": True, "activePermitsBefore": 1}, {"activePermitsAfter": 0, "furtherBodyReads": 0}),
        ("abort-crypto", {"signaturesAttempted": 17, "abortBeforeNext": True}, {"signaturesAttempted": 17, "activePermitsAfter": 0}),
        ("single-flight-host", {"simultaneousSameHostRequests": 8, "coldHost": True}, {"networkCalls": 1, "activeHostMaximum": 1}),
        ("client-scope-preserved", {"charges": [24, 17], "dimension": "clientWindowAttempts", "cap": 40, "nestedProviderAndIssuer": True}, {"requestedTotal": 41, "resourceDecision": "reject", "workBeyondCap": 0}),
        ("origin-scope-preserved", {"charges": [24, 9], "dimension": "originWindowAttempts", "cap": 32}, {"requestedTotal": 33, "resourceDecision": "reject", "workBeyondCap": 0}),
        ("client-request-cannot-raise-cap", {"clientRequested": 99999, "operatorCap": 640}, {"effectiveCap": 640}),
        ("client-request-can-lower-cap", {"clientRequested": 10, "operatorCap": 640}, {"effectiveCap": 10}),
        ("redirect-cap-zero", {"redirectsOffered": 1, "redirectCap": 0}, {"redirectsFollowed": 0, "httpStatus": 401, "httpHeaders": {}}),
        ("quota-error-not-negative-cache", {"failureClass": "budget_exhausted"}, {"negativeCacheSeconds": 0}),
        ("transient-error-not-negative-cache", {"failureClass": "service_unavailable"}, {"negativeCacheSeconds": 0}),
        ("pending-not-negative-cache", {"failureClass": "history_step_limit"}, {"negativeCacheSeconds": 0}),
        ("stale-on-error-forbidden", {"now": NOW+60, "cachedValidUntil": NOW+60, "providerUnavailable": True}, {"staleProofAccepted": False, "resourceGrant": False}),
        ("wall-clock-backward-no-extension", {"remainingAtAcceptanceMs": 10000, "monotonicElapsedMs": 10000, "wallClockChangeSeconds": -3600}, {"remainingMs": 0, "staleProofAccepted": False}),
    ]
    for suffix, objective, expected in objectives:
        value = case("CORE-06", suffix, "limit_exceeded" if expected.get("resourceDecision") == "reject" else None,
                     stage="resource-objective", contract=[LIMITS, PACK+"#5-historyproof-completeness-and-checkpoints", INDEX+"#6-freshness-distribution-and-adversarial-behavior"])
        value["input"]["objective"] = objective
        value["expected"].update(expected)

    files = {"proofs.json": {"format": "ltp-static-input-templates", "soloPruebas": True, "proofs": proofs},
             "signatures.json": {"format": "ltp-original-jws-bytes-hex", "soloPruebas": True, "artifacts": signatures}}
    names = {"CORE-01": "core-01-bootstrap.json", "CORE-02": "core-02-doh.json", "CORE-03": "core-03-did.json",
             "CORE-04": "core-04-history.json", "CORE-05": "core-05-errors.json", "CORE-06": "core-06-resources.json"}
    for area, values in cases.items():
        files[names[area]] = {"format": "ltp-static-case-set", "version": "0.2", "area": area, "cases": values}
    coverage = {"scope": "S3-core static targets only; manual review pending", "areas": []}
    for area, values in cases.items():
        coverage["areas"].append({"id": area, "file": names[area], "cases": [v["id"] for v in values],
            "expectedResults": [{"id": v["id"], "reason": v["expected"]["reason"], "stage": v["expected"]["stage"]} for v in values]})
    files["coverage.json"] = coverage
    original = json.loads((OLD / "manifest.json").read_text())
    files["manifest.json"] = {"format": "ltp-total-conformance-candidate", "version": "0.2", "status": "pending-owner-review",
       "scope": "S1 plus S3-core static targets; no A/B implementation or S4 claim", "originalCorpusDigest": digest(original),
       "schemaBundleDigest": digest(json.loads((SPEC / "schemas/v0.1/manifest.json").read_text())),
       "numericExtensionDigest": digest(json.loads((OLD / "numeric-serialization.json").read_text())),
       "fixtures": [{"file": "../v0.1/"+v["file"], "digest": v["digest"]} for v in original["fixtures"]]
          + [{"file": "../v0.1/numeric-serialization.json", "digest": digest(json.loads((OLD / "numeric-serialization.json").read_text()))}]
          + [{"file": name, "digest": digest(value)} for name, value in sorted(files.items())],
       "coreCases": sum(len(v) for v in cases.values()), "signatureArtifacts": len(signatures)}
    return files


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Create new assets only; never replace differing golden data")
    args = parser.parse_args()
    files = produce()
    if args.publish:
        assert OUT.is_dir(), "Verify the versioned candidate directory before publication"
        # Preflight ALL files: a differing asset aborts before any output write.
        for name, value in files.items():
            path = OUT / name
            if path.exists():
                assert json.loads(path.read_text()) == value, "Refusing to overwrite static candidate: " + name
        for name, value in files.items():
            path = OUT / name
            if not path.exists():
                path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf8")
    if args.check:
        for name, value in files.items():
            assert json.loads((OUT / name).read_text()) == value, "Frozen core asset differs: " + name
    print(json.dumps({"coreCases": files["manifest.json"]["coreCases"], "signatureArtifacts": files["manifest.json"]["signatureArtifacts"],
                      "candidateDigest": digest(files["manifest.json"]), "files": len(files), "productionEngineTested": False}))
