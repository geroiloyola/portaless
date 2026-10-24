#!/usr/bin/env python3
"""CC BY 4.0. Isolated, offline S3 authoring oracle; never imported by Portaless.

Prints static fixtures/patches, never writes files. Only Python standard library.
Published seeds and deterministic RSA primes are TEST MATERIAL, never real keys.
The arithmetic precedes all production-engine work. This is not an LTP verifier.
"""
import argparse
import base64
import copy
import hashlib
import hmac
import json
import math
from fractions import Fraction as F
from pathlib import Path


def b64(b):
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sha(b):
    return hashlib.sha256(b).digest()


def number(n):
    # Fixture-only binary64 spellings; same-author cross-check uses RFC 8785 JCS.
    if not math.isfinite(n):
        raise ValueError("not I-JSON")
    if n == 0:
        return "0"
    if n == int(n) and abs(n) < 1e21:
        return str(int(n))
    s = repr(n)
    if "e" in s:
        mantissa, exponent = s.split("e")
        e = int(exponent)
        if -6 <= e < 21:
            sign = "-" if mantissa.startswith("-") else ""
            digits = mantissa.lstrip("-").replace(".", "")
            point = 1 + e
            return sign + ("0." + "0" * (-point) + digits if point <= 0 else
                           digits[:point] + "." + digits[point:] if point < len(digits) else
                           digits + "0" * (point - len(digits)))
        return mantissa.removesuffix(".0") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return s


def canonical(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        if abs(x) > 9007199254740991:
            raise ValueError("unsafe integer")
        return str(x)
    if isinstance(x, float):
        return number(x)
    if isinstance(x, str):
        return json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    if isinstance(x, list):
        return "[" + ",".join(canonical(v) for v in x) + "]"
    return "{" + ",".join(canonical(k) + ":" + canonical(x[k]) for k in
                          sorted(x, key=lambda k: k.encode("utf-16-be"))) + "}"


def digest(x):
    return b64(sha(canonical(x).encode("utf-8")))


# RFC 8032 Ed25519, affine reference arithmetic (slow, simple, test-only).
Q = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, Q - 2, Q) % Q


def recover_x(y):
    x2 = (y*y - 1) * pow(D*y*y + 1, Q - 2, Q) % Q
    x = pow(x2, (Q + 3)//8, Q)
    if (x*x - x2) % Q:
        x = x * pow(2, (Q - 1)//4, Q) % Q
    return Q - x if x & 1 else x


B = (recover_x(4 * pow(5, Q - 2, Q) % Q), 4 * pow(5, Q - 2, Q) % Q)


def ed_add(p, q):
    x, y = p
    u, v = q
    z = D*x*u*y*v % Q
    return ((x*v + y*u) * pow(1 + z, Q - 2, Q) % Q,
            (y*v + x*u) * pow(1 - z, Q - 2, Q) % Q)


def ed_mul(n, p=B):
    r = (0, 1)
    while n:
        if n & 1:
            r = ed_add(r, p)
        p = ed_add(p, p)
        n >>= 1
    return r


def ed_encode(p):
    return (p[1] | ((p[0] & 1) << 255)).to_bytes(32, "little")


class EdKey:
    def __init__(self, seed):
        self.seed = seed
        h = hashlib.sha512(seed).digest()
        self.scalar = (int.from_bytes(h[:32], "little") & ((1 << 254) - 8)) | (1 << 254)
        self.prefix = h[32:]
        self.public = ed_encode(ed_mul(self.scalar))
        self.jwk = {"crv": "Ed25519", "kty": "OKP", "x": b64(self.public)}

    def sign(self, message):
        r = int.from_bytes(hashlib.sha512(self.prefix + message).digest(), "little") % L
        R = ed_encode(ed_mul(r))
        k = int.from_bytes(hashlib.sha512(R + self.public + message).digest(), "little") % L
        return R + ((r + k*self.scalar) % L).to_bytes(32, "little")


# DNSSEC algorithm 13: fixed P-256 key and RFC 6979 deterministic nonce.
P256 = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
N256 = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
G256 = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
        0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)


def ec_add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    if p[0] == q[0] and (p[1] + q[1]) % P256 == 0:
        return None
    slope = ((3*p[0]*p[0] - 3) * pow(2*p[1], -1, P256) if p == q else
             (q[1] - p[1]) * pow(q[0] - p[0], -1, P256)) % P256
    x = (slope*slope - p[0] - q[0]) % P256
    return x, (slope*(p[0] - x) - p[1]) % P256


def ec_mul(n):
    r, p = None, G256
    while n:
        if n & 1:
            r = ec_add(r, p)
        p = ec_add(p, p)
        n >>= 1
    return r


class ECKey:
    def __init__(self, scalar):
        self.scalar = scalar
        x, y = ec_mul(scalar)
        self.public = x.to_bytes(32, "big") + y.to_bytes(32, "big")
        self.jwk = {"kty": "EC", "crv": "P-256", "x": b64(self.public[:32]), "y": b64(self.public[32:])}

    def sign(self, message):
        h = sha(message)
        v, k = b"\x01"*32, b"\x00"*32
        material = self.scalar.to_bytes(32, "big") + (int.from_bytes(h, "big") % N256).to_bytes(32, "big")
        for sep in [b"\x00", b"\x01"]:
            k = hmac.digest(k, v + sep + material, "sha256")
            v = hmac.digest(k, v, "sha256")
        while True:
            v = hmac.digest(k, v, "sha256")
            nonce = int.from_bytes(v, "big")
            if 0 < nonce < N256:
                r = ec_mul(nonce)[0] % N256
                s = pow(nonce, -1, N256) * (int.from_bytes(h, "big") + r*self.scalar) % N256
                if r and s:
                    return r.to_bytes(32, "big") + s.to_bytes(32, "big")
            k = hmac.digest(k, v + b"\x00", "sha256")
            v = hmac.digest(k, v, "sha256")


def fixture_prime(label):
    # Deterministic TEST-only probable primes, not a production key generator.
    raw = b"".join(sha(label + bytes([i])) for i in range(4))
    n = int.from_bytes(raw, "big") | (3 << 1022) | 1
    while True:
        odd, s = n - 1, 0
        while odd % 2 == 0:
            odd //= 2
            s += 1
        probable = True
        for a in [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]:
            x = pow(a, odd, n)
            if x in (1, n - 1):
                continue
            for _ in range(s - 1):
                x = x*x % n
                if x == n - 1:
                    break
            else:
                probable = False
                break
        if probable and math.gcd(n - 1, 65537) == 1:
            return n
        n += 2


class RSAKey:
    def __init__(self):
        p, q = fixture_prime(b"LTP-S3-RSA-p"), fixture_prime(b"LTP-S3-RSA-q")
        self.n, self.e = p*q, 65537
        self.d = pow(self.e, -1, (p - 1)*(q - 1))
        self.public = b"\x03\x01\x00\x01" + self.n.to_bytes(256, "big")
        self.jwk = {"kty": "RSA", "n": b64(self.n.to_bytes(256, "big")), "e": "AQAB"}

    def sign(self, message):
        info = bytes.fromhex("3031300d060960864801650304020105000420") + sha(message)
        encoded = b"\x00\x01" + b"\xff"*(256 - len(info) - 3) + b"\x00" + info
        return pow(int.from_bytes(encoded, "big"), self.d, self.n).to_bytes(256, "big")


def u16(n):
    return n.to_bytes(2, "big")


def u32(n):
    return n.to_bytes(4, "big")


def dns_name(name):
    return b"".join(bytes([len(s)]) + s.encode("ascii") for s in name.rstrip(".").lower().split(".") if s) + b"\x00"


def rr(owner, typ, rdata, ttl=60):
    return dns_name(owner) + u16(typ) + u16(1) + u32(ttl) + u16(len(rdata)) + rdata


NOW = 1790000000
DID = "did:apw:vector.example"
KID = DID + "#key-1"


def dns_proof(algorithm, root_key, zone_key, txt_bytes):
    ledger = []

    def dnskey(key):
        return u16(257) + bytes([3, algorithm]) + key.public

    def tag(data):
        acc = sum(v << (8 if i % 2 == 0 else 0) for i, v in enumerate(data))
        return (acc + (acc >> 16)) & 65535

    def signed(owner, typ, data, signer, key):
        labels = len(owner.rstrip(".").split(".")) if owner != "." else 0
        prefix = u16(typ) + bytes([algorithm, labels]) + u32(60) + u32(NOW + 3600) + u32(NOW - 3600) + u16(tag(dnskey(key))) + dns_name(signer)
        message = prefix + rr(owner, typ, data)
        signature = key.sign(message)
        sigdata = prefix + signature
        wire = u16(0) + u16(0x8400) + u16(1) + u16(2) + u16(0) + u16(0) + dns_name(owner) + u16(typ) + u16(1) + rr(owner, typ, data) + rr(owner, 46, sigdata)
        ledger.append({"owner": owner, "type": typ, "algorithm": algorithm,
                       "signingInputDigest": b64(sha(message)), "signature": b64(signature), "publicKeyJwk": key.jwk,
                       "wireIndex": len(ledger), "signer": signer})
        return b64(wire)

    root_data, zone_data = dnskey(root_key), dnskey(zone_key)
    delegation = u16(tag(zone_data)) + bytes([algorithm, 2]) + sha(dns_name("example.") + zone_data)
    txt_data = b"".join(bytes([len(txt_bytes[i:i+255])]) + txt_bytes[i:i+255] for i in range(0, len(txt_bytes), 255))
    messages = [signed(".", 48, root_data, ".", root_key),
                signed("example.", 43, delegation, ".", root_key),
                signed("example.", 48, zone_data, "example.", zone_key),
                signed("_apw.vector.example.", 16, txt_data, "example.", zone_key)]
    return {"algorithm": algorithm, "trustAnchor": {"owner": ".", "dnskeyRdata": b64(root_data)},
            "messages": messages, "rrsets": ledger, "dsDigestHex": delegation[4:].hex(),
            "zoneDnskeyRdata": b64(zone_data), "signatureValidUntil": NOW + 3600}


def projection(dimensions, counts):
    included = [(F(w), F(wv)) for w, wv in dimensions if F(w) > 0]
    n = len(included)
    score = sum((10*((12 + wv)/(3 + w) - 1)/6 for w, wv in included), F(0))/n if n else F(5)
    weight = sum((w for w, _ in included), F(0))
    prior = F(3*n)/(3*n + weight) if n else F(1)
    incomplete, inference = counts[0] + counts[1] == 0, prior > F(1, 2)
    level = "pending" if incomplete else "low" if score < 5 else "verify" if score < 7 or inference else "safe" if score < 9 else "trusted"
    p = {"version": "1.0", "profile": "ltp-svri-site-v1", "score": float(score),
         **{f"t{i+1}Count": v for i, v in enumerate(counts)}, "incompleteData": incomplete,
         "isInference": inference, "priorShare": float(prior), "effectiveWeight": float(weight),
         "dimensionCount": n, "rulesVersion": "ltp-svri-site-v1"}
    rational = {k: {"numerator": str(v.numerator), "denominator": str(v.denominator)} for k, v in
                [("score", score), ("priorShare", prior), ("effectiveWeight", weight)]}
    return p, level, rational


def corpus():
    rfc = EdKey(bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
    assert rfc.public.hex() == "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    assert rfc.sign(b"").hex() == ("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
                                   "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
    site = EdKey(bytes(range(32)))
    issuer = EdKey(bytes(range(32, 64)))
    ledger = []

    def jws(name, key, typ, kid, payload, payload_text=None):
        header = canonical({"alg": "EdDSA", "kid": kid, "typ": typ})
        text = canonical(payload) if payload_text is None else payload_text
        message = (b64(header.encode()) + "." + b64(text.encode())).encode("ascii")
        signature = key.sign(message)
        compact = message.decode() + "." + b64(signature)
        ledger.append({"id": name, "publicKeyJwk": key.jwk,
                       "protectedDigest": b64(sha(header.encode())), "payloadDigest": b64(sha(text.encode())),
                       "signingInputDigest": b64(sha(message)), "canonicalPayload": text == canonical(payload),
                       "compact": compact, "sha256": b64(sha(compact.encode("ascii")))})
        return compact

    issuer_id, issuer_kid = "escrow.vector", "escrow-test-key-1"
    claims = [{"typ": "apw-attestation+jws", "iss": issuer_id, "sub": DID,
               "src": "escrow_report", "cat": cat, "val": True, "iat": NOW - 30 + i,
               "jti": f"ltp-vector-escrow-{i+1}"} for i, cat in enumerate(["completed_as_promised", "disputed"])]
    attestations = [jws(f"escrow-{i+1}", issuer, "apw-attestation+jws", issuer_kid, p) for i, p in enumerate(claims)]
    entries, previous = [], None
    for i, a in enumerate(attestations):
        p = {"seq": i+1, "prev": previous, "att": b64(sha(a.encode())), "ts": "2026-09-21T14:13:" + str(10+i) + ".000Z"}
        compact = jws(f"log-{i+1}", site, "apw-log+jws", KID, p)
        entries.append({"seq": i+1, "jws": compact})
        previous = b64(sha(compact.encode()))
    terminal = {"seq": 2, "hash": previous}
    keys = [{"keyId": KID, "fingerprint": digest(site.jwk), "publicKeyJwk": site.jwk,
             "validFrom": "2026-01-01T00:00:00.000Z", "validTo": None}]
    txt = {"v": 2, "siteId": "vector.example", "trustUrl": "/trust/vector.example", "contentKinds": ["mixed"],
           "k": digest(site.jwk), "h": previous, "rg": False}
    manifest_payload = {**txt, "did": DID, "iat": NOW}
    manifest = jws("manifest", site, "apw-manifest+jws", KID, manifest_payload)
    keyset_payload = {"version": "0.1", "did": DID, "keysDigest": digest(keys), "terminal": terminal, "iat": NOW, "exp": NOW + 60}
    keyset = jws("key-set", site, "apw-key-set+jws", KID, keyset_payload)
    history = {"did": DID, "format": "full", "checkpointRef": None, "startSeq": 1, "keys": keys,
               "keySetJws": keyset, "entries": entries, "terminal": terminal}
    history["id"] = digest(history)
    projected, level, rational = projection([("1/2", "2")], [2, 0, 0, 0, 0])
    package = {"typ": "ltp-proof-package", "version": "0.1", "profile": "ltp-site-log-proof-v1", "subject": DID,
               "bootstrapProfile": "independent-doh-ad-v1", "identities": [{"did": DID,
                 "didDocument": {"id": DID, "verificationMethod": [{"id": KID, "type": "JsonWebKey2020", "controller": DID, "publicKeyJwk": site.jwk}]},
                 "manifestJws": manifest, "dnsMessages": [], "historyRef": history["id"]}],
               "histories": [history], "attestations": attestations,
               "issuerBindings": [{"iss": issuer_id, "src": "escrow_report", "kid": issuer_kid, "kind": "local-trust-key", "ref": "escrow-fixture"}],
               "calculation": {"profile": "ltp-svri-site-v1", "rulesVersion": "ltp-svri-site-v1", "coverage": "subject-log-snapshot",
                 "snapshot": {"did": DID, "seq": 2, "head": previous}, "evaluatedAt": NOW,
                 "evidenceSetDigest": digest(sorted({b64(sha(a.encode())) for a in attestations})), "projection": projected},
               "assembledAt": NOW, "expiresAt": NOW + 60}
    request_id = b64(bytes(range(64, 96)))
    request = {"typ": "ltp-resolution-request", "version": "0.1", "requestId": request_id, "subject": DID,
               "profile": package["profile"], "bootstrapProfile": package["bootstrapProfile"], "checkpointIds": [], "resume": [],
               "limits": {"maxPackageBytes": 524288, "maxSignatureVerifications": 640, "deadlineMs": 10000}}
    policy = {"rulesVersion": "ltp-svri-site-v1", "clockSkewSeconds": 0, "maxSnapshotAgeSeconds": 60,
              "issuerRecords": [{"id": "escrow-fixture", "iss": issuer_id, "src": "escrow_report", "kid": issuer_kid,
                                 "publicKeyJwk": issuer.jwk, "validFrom": NOW - 3600, "validUntil": NOW + 3600, "R05": 4}],
              "requiresOnlineObservation": False}
    local = {"now": NOW + 10, "policy": policy, "policyDigest": digest(policy), "checkpoints": [], "quarantined": None,
             "onlineObservation": {"channel": "independent-doh-fixture", "resolverId": "operator-fixture", "receivedAt": NOW,
                "validUntil": NOW + 60, "question": "_apw.vector.example", "AD": True, "TC": False, "Status": 0, "manifest": txt},
             "trustAnchors": [], "resourceGrant": False}
    result = {"typ": "ltp-resolution-result", "version": "0.1", "requestId": request_id, "subject": DID, "profile": package["profile"],
              "bootstrapProfile": package["bootstrapProfile"], "status": "candidate", "package": package,
              "packageDigest": digest(package), "reason": None, "retryAfterSeconds": None}
    expected = {"schemaValid": True, "proofAccepted": True, "stage": "complete", "reason": None,
                "projection": projected, "publicLevel": level, "rational": rational, "resourceGrant": False}
    base = {"id": "valid-proof-chain", "request": request, "result": result, "local": local, "expected": expected}
    files = {"valid-proof-chain.json": base}

    def rebind(p):
        for h in p["histories"]:
            old = h.pop("id")
            h["id"] = digest(h)
            for identity in p["identities"]:
                if identity["historyRef"] == old:
                    identity["historyRef"] = h["id"]

    def materialize(name):
        value = copy.deepcopy(files[name])
        if "base" not in value:
            return value
        obj = materialize(value["base"])
        apply_ops(obj, value["patch"])
        obj.update({"id": value["id"], "expected": value["expected"]})
        return obj

    def apply_ops(obj, ops):
        for op in ops:
            parts = op["path"].split("/")[1:]
            parent = obj
            for part in parts[:-1]:
                parent = parent[int(part)] if isinstance(parent, list) else parent[part]
            key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
            if op["op"] == "remove":
                parent.pop(key)
            else:
                parent[key] = copy.deepcopy(op["value"])

    def case(name, ops, stage, reason, accepted=False, schema=True, base_name="valid-proof-chain.json", repair=True, extra=None):
        obj = materialize(base_name)
        apply_ops(obj, ops)
        p = obj["result"]["package"]
        if repair and p is not None:
            before = copy.deepcopy(p)
            rebind(p)
            # Emit explicit repairs, not runtime digest recomputation by a runner.
            if p != before:
                for i, h in enumerate(p["histories"]):
                    if h["id"] != before["histories"][i]["id"]:
                        ops.append({"op": "replace", "path": f"/result/package/histories/{i}/id", "value": h["id"]})
                for i, identity in enumerate(p["identities"]):
                    if identity["historyRef"] != before["identities"][i]["historyRef"]:
                        ops.append({"op": "replace", "path": f"/result/package/identities/{i}/historyRef", "value": identity["historyRef"]})
            obj["result"]["packageDigest"] = digest(p)
            ops += [{"op": "replace", "path": "/result/packageDigest", "value": obj["result"]["packageDigest"]}]
        if obj["local"]["policy"] != base["local"]["policy"]:
            obj["local"]["policyDigest"] = digest(obj["local"]["policy"])
            ops.append({"op": "replace", "path": "/local/policyDigest", "value": obj["local"]["policyDigest"]})
        exp = {"schemaValid": schema, "proofAccepted": accepted, "stage": stage, "reason": reason, "resourceGrant": False}
        if extra:
            exp.update(extra)
        files[name + ".json"] = {"id": name, "base": base_name, "patch": ops, "expected": exp}
        return obj

    def replace(path, value):
        return {"op": "replace", "path": path, "value": value}

    def corrupt(compact):
        a, b, c = compact.split(".")
        sig = bytearray(unb64(c)); sig[0] ^= 1
        return a + "." + b + "." + b64(sig)

    case("invalid-signature", [replace("/result/package/identities/0/manifestJws", corrupt(manifest))], "identity", "bad_signature")
    case("invalid-key-binding", [replace("/result/package/identities/0/didDocument/verificationMethod/0/publicKeyJwk", issuer.jwk)], "identity", "key_mismatch")
    case("forwarded-ad-not-a-root", [replace("/local/onlineObservation", None)], "bootstrap", "bootstrap_incomplete")
    case("unsigned-dns", [replace("/local/onlineObservation/AD", False)], "bootstrap", "dnssec_required")
    case("wrong-dns-question", [replace("/local/onlineObservation/question", "_apw.attacker.example")], "bootstrap", "bootstrap_invalid")
    case("expired-root", [replace("/local/onlineObservation/validUntil", NOW + 10)], "bootstrap", "freshness_unproven")
    case("request-id-mismatch", [replace("/result/requestId", b64(bytes(32)))], "envelope", "request_binding_mismatch")
    case("package-digest-mismatch", [replace("/result/packageDigest", b64(bytes(32)))], "envelope", "digest_mismatch", repair=False)
    case("missing-null", [{"op": "remove", "path": "/result/retryAfterSeconds"}], "schema", "schema_invalid", schema=False)
    case("string-null", [replace("/result/retryAfterSeconds", "null")], "schema", "schema_invalid", schema=False)
    case("unknown-member", [{"op": "add", "path": "/result/package/verified", "value": True}], "schema", "schema_invalid", schema=False)
    case("retired-draft-alias", [replace("/result/package/typ", "apw-proof-package")], "schema", "unsupported_profile", schema=False)
    case("projection-mismatch", [replace("/result/package/calculation/projection/score", 9)], "projection", "projection_mismatch")
    case("inference-flag-mismatch", [replace("/result/package/calculation/projection/isInference", False)], "projection", "projection_mismatch")
    case("missing-negative-evidence", [{"op": "remove", "path": "/result/package/attestations/1"}], "evidence", "proof_incomplete")
    case("unregistered-issuer", [replace("/local/policy/issuerRecords", [])], "evidence", "issuer_unverified")
    case("invalid-attestation-signature", [replace("/result/package/attestations/1", corrupt(attestations[1]))], "evidence", "att_hash_mismatch")
    case("invalid-log-signature", [replace("/result/package/histories/0/entries/0/jws", corrupt(entries[0]["jws"]))], "history", "bad_signature")
    case("seq-gap", [replace("/result/package/histories/0/entries/1/seq", 3)], "history", "seq_gap")
    expired_keyset = jws("expired-key-set", site, "apw-key-set+jws", KID, {**keyset_payload, "iat": NOW - 60, "exp": NOW + 10})
    case("expired-key-set", [replace("/result/package/histories/0/keySetJws", expired_keyset)], "key-set", "key_set_expired")
    case("changed-key-window", [replace("/result/package/histories/0/keys/0/validFrom", "2025-01-01T00:00:00.000Z")], "key-set", "keys_digest_mismatch")
    noncanonical_manifest = jws("noncanonical-manifest", site, "apw-manifest+jws", KID, manifest_payload, json.dumps(manifest_payload, separators=(", ", ": ")))
    case("valid-signature-noncanonical-payload", [replace("/result/package/identities/0/manifestJws", noncanonical_manifest)], "identity", "not_canonical")
    case("valid-identity-only", [replace("/request/profile", "apw-identity-proof-v1"), replace("/result/profile", "apw-identity-proof-v1"),
         replace("/result/package/profile", "apw-identity-proof-v1"), replace("/result/package/calculation", None),
         replace("/result/package/attestations", []), replace("/result/package/issuerBindings", [])], "complete", None, True)

    # Trusted continuation fixture. Prefix sources are committed separately.
    prefix = {"entries": entries[:1], "attestations": attestations[:1]}
    core = {"did": DID, "seq": 1, "hash": b64(sha(entries[0]["jws"].encode())), "previousTimestamp": "2026-09-21T14:13:10.000Z",
            "keys": keys, "keySetDigest": digest(keys), "rootManifestDigest": digest(txt), "bootstrapProfile": "independent-doh-ad-v1",
            "trustPolicyDigest": digest(policy), "rulesVersion": "ltp-svri-site-v1", "sourceStateDigest": digest(prefix)}
    checkpoint = {"id": digest(core), "core": core, "retainedUntil": NOW + 86400, "validUntil": NOW + 60, "sources": prefix}
    cont = copy.deepcopy(base)
    h = cont["result"]["package"]["histories"][0]
    h.update({"format": "continuation", "checkpointRef": checkpoint["id"], "startSeq": 2, "entries": entries[1:]})
    cont["local"]["checkpoints"] = [checkpoint]
    cont["request"]["checkpointIds"] = [checkpoint["id"]]
    rebind(cont["result"]["package"])
    cont["result"]["packageDigest"] = digest(cont["result"]["package"])
    cont["id"] = "valid-continuation"
    files["valid-continuation.json"] = cont
    case("expired-checkpoint", [replace("/local/checkpoints/0/retainedUntil", NOW + 10)], "checkpoint", "checkpoint_required", base_name="valid-continuation.json")
    case("unknown-checkpoint", [replace("/local/checkpoints", [])], "checkpoint", "checkpoint_required", base_name="valid-continuation.json")

    # Two-step bootstrap with a deliberately stricter fixture step cap of one.
    resume = {"did": DID, "targetManifestDigest": digest({k: v for k, v in manifest_payload.items() if k != "iat"}),
              "rootManifestDigest": digest(txt), "keySetDigest": digest(keys), "nextSeq": 2, "previousHash": core["hash"]}
    first = copy.deepcopy(base)
    h = first["result"]["package"]["histories"][0]
    h.update({"format": "bootstrap-segment", "entries": entries[:1]})
    first["result"]["package"]["attestations"] = attestations[:1]
    first["result"].update({"status": "incomplete", "reason": "history_step_limit", "retryAfterSeconds": 1})
    rebind(first["result"]["package"])
    first["result"]["packageDigest"] = digest(first["result"]["package"])
    first["id"] = "valid-bootstrap-step-1"
    first["expected"] = {"schemaValid": True, "proofAccepted": False, "stage": "history", "reason": "history_step_limit", "resume": resume, "resourceGrant": False}
    files[first["id"] + ".json"] = first
    second = copy.deepcopy(base)
    h = second["result"]["package"]["histories"][0]
    h.update({"format": "bootstrap-segment", "startSeq": 2, "entries": entries[1:]})
    second["local"]["quarantined"] = {"resume": resume, "sources": prefix, "previousTimestamp": core["previousTimestamp"], "validUntil": NOW + 60}
    second["request"]["resume"] = [resume]
    second["id"] = "valid-bootstrap-step-2"
    rebind(second["result"]["package"])
    second["result"]["packageDigest"] = digest(second["result"]["package"])
    files[second["id"] + ".json"] = second
    case("untrusted-bootstrap-prefix", [replace("/local/quarantined", None)], "checkpoint", "checkpoint_required", base_name="valid-bootstrap-step-2.json")

    # Real DNS wire proofs for every mandatory offline-profile algorithm.
    rsa = RSAKey()
    dns = {str(a): dns_proof(a, root, child, canonical(txt).encode()) for a, root, child in
           [(15, EdKey(bytes([2])*32), EdKey(bytes([3])*32)), (13, ECKey(2), ECKey(3)), (8, rsa, rsa)]}
    files["dnssec-proofs.json"] = {"id": "dnssec-proofs", "profiles": dns,
                                  "signatureTimeCases": [{"now": n, "valid": v} for n, v in
                                                         [(NOW - 3601, False), (NOW - 3600, True),
                                                          (NOW + 3600, True), (NOW + 3601, False)]]}
    for a, proof in dns.items():
        case("valid-offline-dnssec-" + a,
             [replace("/request/bootstrapProfile", "dnssec-offline-v1"), replace("/result/bootstrapProfile", "dnssec-offline-v1"),
              replace("/result/package/bootstrapProfile", "dnssec-offline-v1"), replace("/result/package/identities/0/dnsMessages", proof["messages"]),
              replace("/local/onlineObservation", None), replace("/local/trustAnchors", [proof["trustAnchor"]])], "complete", None, True,
             extra={"observation": "offline", "signatureValidUntil": NOW + 3600, "publicLevel": level, "projection": projected})
    offline_base = "valid-offline-dnssec-15.json"
    case("offline-replay-not-online", [replace("/local/policy/requiresOnlineObservation", True)], "bootstrap", "freshness_unproven", base_name=offline_base)
    case("offline-expired-rrsig", [replace("/local/now", NOW + 3601)], "bootstrap", "bootstrap_invalid", base_name=offline_base)
    case("offline-missing-delegation", [{"op": "remove", "path": "/result/package/identities/0/dnsMessages/0"}, {"op": "remove", "path": "/result/package/identities/0/dnsMessages/0"}], "bootstrap", "bootstrap_incomplete", base_name=offline_base)
    damaged = list(dns["15"]["messages"])
    wire = bytearray(unb64(damaged[-1])); wire[-1] ^= 1; damaged[-1] = b64(wire)
    case("offline-invalid-txt-signature", [replace("/result/package/identities/0/dnsMessages/3", damaged[3])], "bootstrap", "bootstrap_invalid", base_name=offline_base)

    references = ["/result/package/attestations/0", "/result/package/attestations/1", "/result/package/histories/0/entries/0/jws",
                  "/result/package/histories/0/entries/1/jws", "/result/package/identities/0/manifestJws", "/result/package/histories/0/keySetJws"]
    for i, item in enumerate(ledger):
        item.pop("compact")
        item["ref"] = {"file": "valid-proof-chain.json" if i < 6 else "expired-key-set.json" if i == 6 else "valid-signature-noncanonical-payload.json",
                       "pointer": references[i] if i < 6 else "/patch/0/value"}
    files["crypto-ledger.json"] = {"id": "crypto-ledger", "testOnlySeeds": {"site": bytes(range(32)).hex(), "issuer": bytes(range(32, 64)).hex()},
                                   "jws": ledger, "rootManifestUtf8": canonical(txt), "rootManifestDigest": digest(txt), "keySetDigest": digest(keys),
                                   "historyId": history["id"], "evidenceSetDigest": package["calculation"]["evidenceSetDigest"]}
    math_cases = []
    for name, dims, counts in [
        ("prior-only", [], [0, 0, 0, 0, 0]), ("t4-not-w-evidence", [], [0, 0, 0, 3, 0]),
        ("one-escrow", [("1/4", "7/4")], [1, 0, 0, 0, 0]),
        ("positive-and-negative", [("1/2", "2")], [2, 0, 0, 0, 0]),
        ("half-prior-exact", [("3", "21")], [3, 0, 0, 0, 0]),
        ("only-t3-t5-high-score", [("12", "84")], [0, 0, 6, 0, 6]),
        ("score-five", [("4", "16")], [4, 0, 0, 0, 0]),
        ("score-seven-inferred", [("2", "14")], [2, 0, 0, 0, 0]),
        ("score-seven-safe", [("24/7", "150/7")], [4, 0, 0, 0, 0]),
        ("score-nine", [("12", "84")], [12, 0, 0, 0, 0]),
        ("below-five-unrounded", [("4", "15999999999999/1000000000000")], [4, 0, 0, 0, 0]),
        ("below-nine-unrounded", [("12", "83999999999999/1000000000000")], [12, 0, 0, 0, 0]),
        ("two-dimension-mean", [("1/4", "7/4"), ("1", "1")], [1, 1, 0, 0, 0])]:
        p, level, exact = projection(dims, counts)
        math_cases.append({"id": name, "input": {"dimensions": [{"weight": w, "weightedValue": wv} for w, wv in dims], "counts": counts},
                           "expected": {"projection": p, "publicLevel": level, "rational": exact}})
    files["svri-math.json"] = {"id": "svri-math", "scope": "Projection arithmetic over explicitly supplied already-admissible dimension totals, not proof of source selection.", "cases": math_cases}
    encoding = []
    for name, obj in [("null-explicit", {"a": None}), ("member-absent", {}), ("unicode-utf16-order", {"\ue000": "private", "😀": "astral", "a": "é"}),
                      ("unicode-not-normalized", {"nfc": "é", "nfd": "e\u0301"}), ("number-not-string", {"n": 1, "s": "1"}),
                      ("number-spellings", [-0.0, 1e-7, 1e-6, 1.25]), ("array-order-a", [1, 2]), ("array-order-b", [2, 1])]:
        text = canonical(obj)
        encoding.append({"id": name, "input": obj, "canonicalUtf8": text, "canonicalHex": text.encode().hex(), "digest": digest(obj)})
    raw_invalid = [("duplicate-member", b'{"a":1,"a":2}'), ("escaped-duplicate", b'{"a":1,"\\u0061":2}'),
                   ("bom", b'\xef\xbb\xbf{}'), ("invalid-utf8", b'{"a":"\xff"}'),
                   ("lone-surrogate", b'{"a":"\\ud800"}'), ("nan", b'{"a":NaN}'), ("unsafe-integer", b'{"a":9007199254740992}')]
    files["encoding.json"] = {"id": "encoding", "cases": encoding, "invalidJson": [{"id": n, "wireHex": b.hex(), "expected": "invalid_json"} for n, b in raw_invalid]}
    # Positive continuations/bootstrap use literal RFC 6902 changes to the base,
    # avoiding duplicated signed corpora. No digest is computed by the consumer.
    def difference(a, b, path=""):
        if a == b:
            return []
        if isinstance(a, dict) and isinstance(b, dict) and a.keys() == b.keys():
            return [op for key in a for op in difference(a[key], b[key], path + "/" + key)]
        if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
            return [op for i in range(len(a)) for op in difference(a[i], b[i], path + "/" + str(i))]
        return [{"op": "replace", "path": path, "value": b}]
    for name in ["valid-continuation.json", "valid-bootstrap-step-1.json", "valid-bootstrap-step-2.json"]:
        obj = files[name]
        files[name] = {"id": obj["id"], "base": "valid-proof-chain.json",
                       "patch": difference({k: v for k, v in base.items() if k not in ("id", "expected")},
                                           {k: v for k, v in obj.items() if k not in ("id", "expected")}), "expected": obj["expected"]}
    files["manifest.json"] = {"format": "ltp-conformance-corpus", "version": "0.1", "status": "candidate-awaiting-owner-approval",
                              "digestRule": "base64url(SHA256(UTF8(RFC8785-JCS(parsedFixture)))), without padding",
                              "fixtures": [{"file": name, "digest": digest(files[name])} for name in sorted(files)]}
    return files


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit", help="Print one immutable JSON fixture candidate")
    parser.add_argument("--check", action="store_true", help="Read-only comparison of static candidates with isolated authoring math")
    parser.add_argument("--patch", choices=["base", "negative", "dns", "math"], help="Print apply_patch input; no filesystem writes")
    args = parser.parse_args()
    files = corpus()
    group = lambda name: "dns" if name == "dnssec-proofs.json" or name.startswith("valid-offline-") else "math" if name in ("encoding.json", "svri-math.json", "manifest.json") else "base" if name.startswith("valid-") or name == "crypto-ledger.json" else "negative"
    if args.check:
        root = Path(__file__).resolve().parent.parent
        for name, expected in files.items():
            actual = json.loads((root / name).read_text(encoding="utf-8"))
            assert actual == expected, "Static fixture differs from authoring calculation: " + name
        print(f"Read-only authoring cross-check: {len(files)} static files match; RFC 8032 self-check passed")
    elif args.emit:
        print(json.dumps(files[args.emit], ensure_ascii=False, indent=2, allow_nan=False))
    elif args.patch:
        print("*** Begin Patch")
        for name, value in files.items():
            if group(name) == args.patch:
                print("*** Add File: docs/protocol-apw/vectors/ltp/v0.1/" + name)
                for line in json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).splitlines():
                    print("+" + line)
        print("*** End Patch")
    else:
        print(json.dumps({"files": list(files), "count": len(files)}, indent=2))
