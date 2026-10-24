#!/usr/bin/env python3
"""CC BY 4.0. Fixture-only static reputation oracle for G4.

This tool precomputes the REP-01…REP-11 JSON targets using Python's binary64
arithmetic. It is NOT the Portaless reputation engine, is never imported by the
runtime, and does not implement an SVRI verifier. The TypeScript engine remains
blocked until these static files are audited.
"""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path

SPEC = Path(__file__).resolve().parent.parent
OUT = SPEC / "vectors/ltp/reputation/v0.1"
P = 3.0
NEUTRAL = 4.0
TOLERANCE = 1e-9
MAX_EMITTERS = 2
SEVEN_DAYS = 7 * 24 * 60 * 60
ROLLOVER_GRACE = 600


def b64(bytes_value):
    return base64.urlsafe_b64encode(bytes_value).decode("ascii").rstrip("=")


def sha(bytes_value):
    return hashlib.sha256(bytes_value).digest()


def number(value):
    if not math.isfinite(value):
        raise ValueError("not I-JSON")
    if value == 0:
        return "0"
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" in text:
        mantissa, exponent = text.split("e")
        exp = int(exponent)
        if -6 <= exp < 21:
            sign = "-" if mantissa.startswith("-") else ""
            digits = mantissa.lstrip("-").replace(".", "")
            point = 1 + exp
            if point <= 0:
                return sign + "0." + "0" * (-point) + digits
            if point < len(digits):
                return sign + digits[:point] + "." + digits[point:]
            return sign + digits + "0" * (point - len(digits))
        return mantissa.removesuffix(".0") + "e" + ("+" if exp >= 0 else "-") + str(abs(exp))
    return text


def canonical(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        if abs(value) > 9007199254740991:
            raise ValueError("unsafe integer")
        return str(value)
    if isinstance(value, float):
        return number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return "{" + ",".join(
        canonical(key) + ":" + canonical(value[key])
        for key in sorted(value, key=lambda item: item.encode("utf-16-be"))
    ) + "}"


def digest(value):
    return b64(sha(canonical(value).encode("utf-8")))


def issuer_weight(j):
    c = min(7.0, max(1.0, j))
    return ((c - 1.0) / 6.0) ** 2


def dimension(score, weight_sum, count=1, name="W-05"):
    return {"dimension": name, "score": score, "count": count, "weightSum": weight_sum}


def project(dimensions, t1=0, t2=0, t3=0, t4=0, t5=0):
    if dimensions:
        score10 = [10.0 * (item["score"] - 1.0) / 6.0 for item in dimensions]
        score = sum(score10) / len(score10)
        effective_weight = sum(item["weightSum"] for item in dimensions)
        dimension_count = len(dimensions)
    else:
        score = 5.0
        effective_weight = 0.0
        dimension_count = 0
    prior_share = 1.0 if dimension_count == 0 else (
        3.0 * dimension_count / (3.0 * dimension_count + effective_weight)
    )
    is_inference = prior_share > 0.5
    incomplete = (t1 + t2 == 0)
    if incomplete or not math.isfinite(score):
        level = "pending"
    elif score < 5.0:
        level = "low"
    elif score < 7.0 or is_inference:
        level = "verify"
    elif score < 9.0:
        level = "safe"
    else:
        level = "trusted"
    return {
        "version": "1.0",
        "profile": "ltp-svri-site-v1",
        "score": score,
        "t1Count": t1,
        "t2Count": t2,
        "t3Count": t3,
        "t4Count": t4,
        "t5Count": t5,
        "incompleteData": incomplete,
        "isInference": is_inference,
        "priorShare": prior_share,
        "effectiveWeight": effective_weight,
        "dimensionCount": dimension_count,
        "publicLevel": level,
    }


def case(case_id, kind, description, input_value, expected):
    return {
        "id": case_id,
        "kind": kind,
        "description": description,
        "input": input_value,
        "expected": expected,
    }


def issuer_decision(*, key_ts, valid_from, valid_to, grace=ROLLOVER_GRACE, chain=True,
                    self_issuer=False, key_matches_did=True, aliases=1, distinct=1):
    reasons = []
    if not key_matches_did:
        reasons.append("issuer_key_not_bound")
    if self_issuer:
        reasons.append("self_issuer_excluded")
    if not chain:
        reasons.append("issuer_chain_incomplete")
    if key_ts < valid_from:
        reasons.append("key_before_valid_from")
    if key_ts > valid_to + grace:
        reasons.append("key_after_valid_to_and_grace")
    eligible = not reasons
    return {
        "eligible": eligible,
        "reason": reasons[0] if reasons else None,
        "weight": 0.25 if eligible else 0.0,
        "distinctEmitters": distinct,
        "aliasesCollapsed": aliases,
    }


def build_rep01():
    cases = [
        case("REP-01-01", "issuerEligibility", "Valid issuer key, window and complete chain.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "chain": True},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100)),
        case("REP-01-02", "issuerEligibility", "Issuer key does not belong to the attested DID.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "keyMatchesDid": False},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, key_matches_did=False)),
        case("REP-01-03", "issuerEligibility", "Issuer identity/history is missing.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "chain": False},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, chain=False)),
        case("REP-01-04", "issuerEligibility", "Attestation timestamp exactly at validFrom.",
             {"keyTs": 900, "validFrom": 900, "validTo": 1100},
             issuer_decision(key_ts=900, valid_from=900, valid_to=1100)),
        case("REP-01-05", "issuerEligibility", "Attestation timestamp exactly at validTo.",
             {"keyTs": 1100, "validFrom": 900, "validTo": 1100},
             issuer_decision(key_ts=1100, valid_from=900, valid_to=1100)),
        case("REP-01-06", "issuerEligibility", "One second before validFrom and after validTo+grace.",
             {"keyTs": [899, 1701], "validFrom": 900, "validTo": 1100, "grace": 600},
             {"eligible": [False, False], "reason": ["key_before_valid_from", "key_after_valid_to_and_grace"]}),
        case("REP-01-07", "issuerEligibility", "Retired key at validTo+grace and one second after.",
             {"keyTs": [1700, 1701], "validFrom": 900, "validTo": 1100, "grace": 600},
             {"eligible": [True, False], "reason": [None, "key_after_valid_to_and_grace"]}),
        case("REP-01-08", "issuerEligibility", "Self-issuer or issuer equal to the reader.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "selfIssuer": True},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, self_issuer=True)),
        case("REP-01-09", "issuerEligibility", "Incomplete chain or JWS hash not anchored.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "chain": False},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, chain=False)),
        case("REP-01-10", "issuerEligibility", "Same DID under several domains/aliases.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "aliases": 2, "distinct": 1},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, aliases=2, distinct=1)),
        case("REP-01-11", "issuerEligibility", "Two distinct did:apw controlled by one operator.",
             {"keyTs": 1000, "validFrom": 900, "validTo": 1100, "aliases": 2, "distinct": 2},
             issuer_decision(key_ts=1000, valid_from=900, valid_to=1100, aliases=2, distinct=2)),
    ]
    return "REP-01 — Issuer identity and chain", cases


def attestation_decision(*, valid=True, kid=True, canonical_payload=True, typ=True,
                         iat_in_window=True, duplicate=False, public_only=True, sub=True):
    reasons = []
    if not valid:
        reasons.append("bad_signature")
    if not kid:
        reasons.append("kid_not_in_issuer_keys")
    if not canonical_payload:
        reasons.append("not_canonical")
    if not typ:
        reasons.append("unsupported_typ")
    if not iat_in_window:
        reasons.append("iat_outside_key_window")
    if not public_only:
        reasons.append("private_key_material")
    if not sub:
        reasons.append("subject_mismatch")
    accepted = not reasons
    return {
        "accepted": accepted,
        "reason": reasons[0] if reasons else None,
        "count": 1 if accepted else 0,
        "deduped": bool(duplicate and accepted),
    }


def build_rep02():
    cases = [
        case("REP-02-01", "attestationIntegrity", "Valid Ed25519 over exact compact JWS.",
             {"validSignature": True, "kidMatches": True, "canonical": True, "typ": True, "iatInWindow": True},
             attestation_decision()),
        case("REP-02-02", "attestationIntegrity", "One-bit signature mutation.",
             {"validSignature": False},
             attestation_decision(valid=False)),
        case("REP-02-03", "attestationIntegrity", "Wrong kid or key not in issuer key set.",
             {"kidMatches": False},
             attestation_decision(kid=False)),
        case("REP-02-04", "attestationIntegrity", "Payload is not equal to JCS(JSON.parse(payload)).",
             {"canonical": False},
             attestation_decision(canonical_payload=False)),
        case("REP-02-05", "attestationIntegrity", "Wrong typ or unsupported algorithm.",
             {"typ": False},
             attestation_decision(typ=False)),
        case("REP-02-06", "attestationIntegrity", "iat outside key window or expired attestation.",
             {"iatInWindow": False},
             attestation_decision(iat_in_window=False)),
        case("REP-02-07", "attestationIntegrity", "Identical JWS retransmitted.",
             {"validSignature": True, "duplicate": True},
             attestation_decision(duplicate=True)),
        case("REP-02-08", "attestationIntegrity", "Private key member or malformed JWK.",
             {"publicKeyOnly": False},
             attestation_decision(public_only=False)),
        case("REP-02-09", "attestationIntegrity", "Valid signature but wrong subject.",
             {"subjectMatches": False},
             attestation_decision(sub=False)),
    ]
    return "REP-02 — Attestation signature and canonical bytes", cases


def dedupe(items):
    seen = {}
    duplicates = 0
    conflicts = 0
    invalid = 0
    for item in items:
        if not item.get("iss") or not item.get("jti"):
            invalid += 1
            continue
        key = (item["iss"], item["jti"])
        if key in seen:
            if seen[key]["payload"] != item["payload"]:
                conflicts += 1
                seen[key]["conflict"] = True
            else:
                duplicates += 1
        else:
            seen[key] = dict(item)
    accepted = sum(1 for item in seen.values() if not item.get("conflict"))
    return {
        "accepted": accepted,
        "unique": len(seen),
        "duplicates": duplicates,
        "conflicts": conflicts,
        "invalid": invalid,
    }


def build_rep03():
    a = {"iss": "did:apw:issuer.example", "jti": "j1", "payload": "p1"}
    b = {"iss": "did:apw:issuer.example", "jti": "j1", "payload": "p2"}
    c = {"iss": "did:apw:other.example", "jti": "j1", "payload": "p1"}
    cases = [
        case("REP-03-01", "attestationUniqueness", "Same (iss,jti), identical payload, repeated.",
             {"items": [a, a]}, dedupe([a, a])),
        case("REP-03-02", "attestationUniqueness", "Same (iss,jti), different payload.",
             {"items": [a, b]}, dedupe([a, b])),
        case("REP-03-03", "attestationUniqueness", "Same (iss,jti) across two stores.",
             {"stores": [[a], [a]]}, {"accepted": 1, "unique": 1, "duplicates": 1, "conflicts": 0, "invalid": 0}),
        case("REP-03-04", "attestationUniqueness", "Same jti, different iss.",
             {"items": [a, c]}, dedupe([a, c])),
        case("REP-03-05", "attestationUniqueness", "Missing iss or jti.",
             {"items": [{"iss": None, "jti": "j1", "payload": "p1"}]}, dedupe([{"iss": None, "jti": "j1", "payload": "p1"}])),
        case("REP-03-06", "attestationUniqueness", "Permutation of a valid set.",
             {"orders": [[a, c], [c, a]]}, {"sameResult": True, "accepted": 2, "conflicts": 0}),
        case("REP-03-07", "attestationUniqueness", "Duplicate (iss,jti), one valid and one mutated.",
             {"items": [a, {**a, "payload": "mutated"}]}, dedupe([a, {**a, "payload": "mutated"}])),
        case("REP-03-08", "attestationUniqueness", "Legacy row without JWS after cutoff.",
             {"legacy": True, "hasJws": False, "tsAfterCutoff": True},
             {"completeness": "broken", "reason": "apw_unresolvable", "count": 0}),
        case("REP-03-09", "attestationUniqueness", "Legacy row before cutoff with ignore/reject policy.",
             {"legacy": True, "hasJws": False, "tsAfterCutoff": False, "policies": ["ignore", "reject"]},
             {"ignore": "ignored", "reject": "apw_unresolvable", "count": 0}),
    ]
    return "REP-03 — (iss,jti) uniqueness and conflicts", cases


def eligibility(emitters, min_weight, max_emitters=MAX_EMITTERS):
    eligible = [e for e in emitters if e["ageSeconds"] >= SEVEN_DAYS and not e.get("self")]
    distinct = {}
    for emitter in eligible:
        distinct.setdefault(emitter["did"], emitter)
    selected = sorted(distinct.values(), key=lambda item: item["did"])[:max_emitters]
    weight_sum = sum(item["weight"] for item in selected)
    over_cap = len(distinct) > max_emitters
    passes = weight_sum >= min_weight and len(selected) > 0
    return {
        "eligible": len(eligible) > 0,
        "eligibleEmitters": len(eligible),
        "distinctEmitters": len(distinct),
        "acceptedEmitters": len(selected),
        "overFanoutCap": over_cap,
        "weightSum": weight_sum,
        "countsTowardMinWeight": weight_sum > 0,
        "minWeight": min_weight,
        "minWeightPass": passes,
        "absent": not passes,
        "rejectedByCap": max(0, len(distinct) - max_emitters),
    }


def emitter(did, age_seconds=SEVEN_DAYS, weight=1.0, self_issuer=False):
    return {"did": did, "ageSeconds": age_seconds, "weight": weight, "self": self_issuer}


def build_rep04():
    cases = [
        case("REP-04-01", "communityEligibility", "Emitter history exactly 7 days.",
             {"emitters": [emitter("did:apw:a.example", SEVEN_DAYS)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", SEVEN_DAYS)], 2.0)),
        case("REP-04-02", "communityEligibility", "Emitter age 7 days minus one second.",
             {"emitters": [emitter("did:apw:a.example", SEVEN_DAYS - 1)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", SEVEN_DAYS - 1)], 2.0)),
        case("REP-04-03", "communityEligibility", "Emitter age one second over 7 days.",
             {"emitters": [emitter("did:apw:a.example", SEVEN_DAYS + 1)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", SEVEN_DAYS + 1)], 2.0)),
        case("REP-04-04", "communityEligibility", "min_weight exactly 2.0 with two eligible distinct emitters.",
             {"emitters": [emitter("did:apw:a.example"), emitter("did:apw:b.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example"), emitter("did:apw:b.example")], 2.0)),
        case("REP-04-05", "communityEligibility", "Weight sum 1.999999999, just below min_weight 2.0.",
             {"emitters": [emitter("did:apw:a.example", weight=1.0), emitter("did:apw:b.example", weight=0.999999999)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", weight=1.0), emitter("did:apw:b.example", weight=0.999999999)], 2.0)),
        case("REP-04-06", "communityEligibility", "One eligible emitter below min_weight.",
             {"emitters": [emitter("did:apw:a.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example")], 2.0)),
        case("REP-04-07", "communityEligibility", "Exactly two distinct eligible emitters.",
             {"emitters": [emitter("did:apw:a.example"), emitter("did:apw:b.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example"), emitter("did:apw:b.example")], 2.0)),
        case("REP-04-08", "communityEligibility", "Three distinct emitters over the fan-out cap.",
             {"emitters": [emitter("did:apw:a.example"), emitter("did:apw:b.example"), emitter("did:apw:c.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example"), emitter("did:apw:b.example"), emitter("did:apw:c.example")], 2.0)),
        case("REP-04-09", "communityEligibility", "Same DID via several domains/aliases.",
             {"emitters": [emitter("did:apw:a.example"), emitter("did:apw:a.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example"), emitter("did:apw:a.example")], 2.0)),
        case("REP-04-10", "communityEligibility", "Two domains owned by one operator, distinct DIDs.",
             {"emitters": [emitter("did:apw:a.example"), emitter("did:apw:b.example")], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example"), emitter("did:apw:b.example")], 2.0)),
        case("REP-04-11", "communityEligibility", "Self-attestation or attestation about own subject.",
             {"emitters": [emitter("did:apw:a.example", self_issuer=True)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", self_issuer=True)], 2.0)),
        case("REP-04-12", "communityEligibility", "Weight-0 emitter recorded but not counted.",
             {"emitters": [emitter("did:apw:a.example", weight=0.0)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", weight=0.0)], 2.0)),
        case("REP-04-13", "communityEligibility", "Age 7d-1s combined with min_weight exactly 2.0.",
             {"emitters": [emitter("did:apw:a.example", SEVEN_DAYS - 1)], "minWeight": 2.0},
             eligibility([emitter("did:apw:a.example", SEVEN_DAYS - 1)], 2.0)),
        case("REP-04-14", "communityEligibility", "Only T3/T5 sources, no T1/T2.",
             {"t1": 0, "t2": 0, "t3": 6, "t5": 6},
             {"incompleteData": True, "completeSiteClaim": False}),
    ]
    return "REP-04 — Community eligibility, age and min_weight", cases


def category_value(category, value):
    if category == "community":
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            return {"error": "invalid_community_value"}
        if value < 1 or value > 5:
            return {"error": "community_out_of_range"}
        return {"dimension": "W-10", "value": 1.0 + ((value - 1.0) * 6.0) / 4.0}
    mapping = {
        "respected_policy": ("R-01", 7.0, 1.0),
        "policy_violation": ("R-01", 1.0, 7.0),
        "rate_respected": ("R-02", 7.0, 1.0),
        "paid_as_agreed": ("R-03", 7.0, 1.0),
        "redistribution": ("R-04", 1.0, 7.0),
    }
    if category not in mapping:
        return {"error": "unknown_category"}
    if not isinstance(value, bool):
        return {"error": "non_boolean_value"}
    name, yes, no = mapping[category]
    return {"dimension": name, "value": yes if value else no}


def build_rep05():
    cases = [
        case("REP-05-01", "readerConductMapping", "respected_policy true.", {"category": "respected_policy", "value": True}, category_value("respected_policy", True)),
        case("REP-05-02", "readerConductMapping", "respected_policy false.", {"category": "respected_policy", "value": False}, category_value("respected_policy", False)),
        case("REP-05-03", "readerConductMapping", "policy_violation true.", {"category": "policy_violation", "value": True}, category_value("policy_violation", True)),
        case("REP-05-04", "readerConductMapping", "policy_violation false.", {"category": "policy_violation", "value": False}, category_value("policy_violation", False)),
        case("REP-05-05", "readerConductMapping", "rate_respected true/false.", {"category": "rate_respected", "value": [True, False]}, {"values": [category_value("rate_respected", True), category_value("rate_respected", False)]}),
        case("REP-05-06", "readerConductMapping", "paid_as_agreed true/false.", {"category": "paid_as_agreed", "value": [True, False]}, {"values": [category_value("paid_as_agreed", True), category_value("paid_as_agreed", False)]}),
        case("REP-05-07", "readerConductMapping", "redistribution true.", {"category": "redistribution", "value": True}, category_value("redistribution", True)),
        case("REP-05-08", "readerConductMapping", "Unknown category.", {"category": "unknown", "value": True}, category_value("unknown", True)),
        case("REP-05-09", "readerConductMapping", "Non-boolean value for a boolean category.", {"category": "respected_policy", "value": 1}, category_value("respected_policy", 1)),
        case("REP-05-10", "readerConductMapping", "Community values 1, 2.5, 4, 5.5, 7 and invalid 0/6/NaN.",
             {"category": "community", "values": [1, 2.5, 4, 5.5, 7, 0, 6, "NaN"]},
             {"values": [category_value("community", 1), category_value("community", 2.5), category_value("community", 4), category_value("community", 5.5), category_value("community", 7), category_value("community", 0), category_value("community", 6), category_value("community", "NaN")]}),
        case("REP-05-11", "readerConductMapping", "T4 activity on a site is not W evidence.", {"t4Count": 3}, {"t4Count": 3, "wEvidence": False, "scoreWeight": 0.0}),
        case("REP-05-12", "readerConductMapping", "Reader-conduct for a different subject.", {"subject": "did:apw:a.example", "attestationSubject": "did:apw:b.example"}, {"excluded": True, "reason": "subject_mismatch"}),
    ]
    return "REP-05 — Reader-conduct categories and values", cases


def reader_decision(*, signature=True, issuer_matches_reader=True, issuer_is_reader=False,
                    missing_jws_after_cutoff=False, missing_jws_before_cutoff=False,
                    policy="ignore", hash_anchored=True, unsigned_legacy=False,
                    omission=False, t4_only=False):
    if not signature:
        return {"resolvable": False, "reason": "apw_unresolvable", "excluded": True}
    if not issuer_matches_reader:
        return {"resolvable": False, "reason": "issuer_not_reader_key", "excluded": True}
    if issuer_is_reader:
        return {"resolvable": True, "excluded": True, "reason": "self_issuer_excluded"}
    if missing_jws_after_cutoff:
        return {"resolvable": False, "reason": "apw_unresolvable", "completeness": "broken"}
    if missing_jws_before_cutoff:
        if policy == "reject":
            return {"resolvable": False, "reason": "apw_unresolvable", "completeness": "broken"}
        return {"resolvable": True, "ignored": True, "count": 0}
    if not hash_anchored:
        return {"resolvable": True, "dropped": True, "count": 0}
    if unsigned_legacy:
        return {"resolvable": True, "ignored": True, "count": 0}
    if omission:
        return {"resolvable": True, "completenessClaim": False, "omissionDetectable": False}
    if t4_only:
        return {"resolvable": True, "t4Activity": True, "wEvidence": False}
    return {"resolvable": True, "count": 1}


def build_rep06():
    cases = [
        case("REP-06-01", "readerConductNegative", "Wrong issuer key/signature.", {"signature": False}, reader_decision(signature=False)),
        case("REP-06-02", "readerConductNegative", "Issuer is not the reader TXT k.", {"issuerMatchesReader": False}, reader_decision(issuer_matches_reader=False)),
        case("REP-06-03", "readerConductNegative", "Issuer equals the reader.", {"issuerIsReader": True}, reader_decision(issuer_is_reader=True)),
        case("REP-06-04", "readerConductNegative", "Missing JWS after legacy cutoff.", {"missingJwsAfterCutoff": True}, reader_decision(missing_jws_after_cutoff=True)),
        case("REP-06-05", "readerConductNegative", "Missing JWS before cutoff, ignore.", {"missingJwsBeforeCutoff": True, "policy": "ignore"}, reader_decision(missing_jws_before_cutoff=True, policy="ignore")),
        case("REP-06-06", "readerConductNegative", "Missing JWS before cutoff, reject.", {"missingJwsBeforeCutoff": True, "policy": "reject"}, reader_decision(missing_jws_before_cutoff=True, policy="reject")),
        case("REP-06-07", "readerConductNegative", "JWS hash not present in the chain.", {"hashAnchored": False}, reader_decision(hash_anchored=False)),
        case("REP-06-08", "readerConductNegative", "Unsigned legacy row.", {"unsignedLegacy": True}, reader_decision(unsigned_legacy=True)),
        case("REP-06-09", "readerConductNegative", "Origin omission / equivocation is not detectable from one chain.", {"omission": True}, reader_decision(omission=True)),
        case("REP-06-10", "readerConductNegative", "T4 activity vs W evidence.", {"t4Only": True}, reader_decision(t4_only=True)),
    ]
    return "REP-06 — Reader-conduct negatives and completeness", cases


def build_rep07():
    cases = [
        case("REP-07-01", "svriNoData", "No attestations.", {"dimensions": [], "counts": [0, 0, 0, 0, 0]}, project([], 0, 0, 0, 0, 0)),
        case("REP-07-02", "svriNoData", "Only T3/T5 sources.", {"dimensions": [dimension(6.4, 12, 6)], "counts": [0, 0, 6, 0, 6]}, project([dimension(6.4, 12, 6)], 0, 0, 6, 0, 6)),
        case("REP-07-03", "svriNoData", "Below min_weight.", {"weightSum": 1.999999999, "minWeight": 2.0}, {"minWeightPass": False, "subjectAbsent": True}),
        case("REP-07-04", "svriNoData", "priorShare exactly 0.5.", {"dimensions": [dimension(4.0, 3.0)], "counts": [1, 0, 0, 0, 0]}, project([dimension(4.0, 3.0)], 1, 0, 0, 0, 0)),
        case("REP-07-05", "svriNoData", "priorShare just above and below 0.5.", {"weightSums": [2.999999999, 3.000000001]}, {"inference": [True, False]}),
        case("REP-07-06", "svriNoData", "Zero effective dimensions with T4 activity.", {"dimensions": [], "counts": [0, 0, 0, 3, 0]}, project([], 0, 0, 0, 3, 0)),
        case("REP-07-07", "svriNoData", "Declared dimension without data.", {"declaredDimensions": ["W-05"], "dimensions": []}, {"dimensionCount": 0, "score": 5.0, "absentDimensions": ["W-05"]}),
        case("REP-07-08", "svriNoData", "T4 activity only.", {"dimensions": [], "counts": [0, 0, 0, 3, 0]}, project([], 0, 0, 0, 3, 0)),
        case("REP-07-09", "svriNoData", "Incomplete data with a high raw score.", {"dimensions": [dimension(6.4, 12)], "counts": [0, 0, 6, 0, 6]}, project([dimension(6.4, 12)], 0, 0, 6, 0, 6)),
        case("REP-07-10", "svriNoData", "Unknown or malformed source.", {"source": "unknown"}, {"excluded": True, "reason": "unsupported_source", "count": 0}),
    ]
    return "REP-07 — No-data and insufficient evidence", cases


def build_rep08():
    def target(score10, weight_sum=3.0, t1=1, t2=0, t3=0, t4=0, t5=0):
        return project([dimension(1.0 + 6.0 * score10 / 10.0, weight_sum)], t1, t2, t3, t4, t5)

    cases = [
        case("REP-08-01", "svriBoundary", "Score exactly 5.0.", {"dimensions": [dimension(4.0, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(5.0)),
        case("REP-08-02", "svriBoundary", "Score 4.999999999 just below 5.", {"dimensions": [dimension(1.0 + 6.0 * 4.999999999 / 10.0, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(4.999999999)),
        case("REP-08-03", "svriBoundary", "Score exactly 7.0 with isInference=false.", {"dimensions": [dimension(5.2, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(7.0)),
        case("REP-08-04", "svriBoundary", "Score 6.999999999 just below 7.", {"dimensions": [dimension(1.0 + 6.0 * 6.999999999 / 10.0, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(6.999999999)),
        case("REP-08-05", "svriBoundary", "Score exactly 9.0, complete, non-inference, T1/T2 present.", {"dimensions": [dimension(6.4, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(9.0)),
        case("REP-08-06", "svriBoundary", "Score 8.999999999 just below 9.", {"dimensions": [dimension(1.0 + 6.0 * 8.999999999 / 10.0, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(8.999999999)),
        case("REP-08-07", "svriBoundary", "Two scores equal after 6-decimal rounding.", {"entries": [{"subject": "b", "score": 5.0, "weightSum": 2.0, "count": 2}, {"subject": "a", "score": 5.0, "weightSum": 3.0, "count": 1}]}, {"order": ["a", "b"], "rule": "score desc, weight desc, count desc, subject asc"}),
        case("REP-08-08", "svriBoundary", "Two values within 1e-9.", {"values": [1.0, 1.0 + 5e-10]}, {"withinTolerance": True, "exactEqual": False, "tolerance": TOLERANCE}),
        case("REP-08-09", "svriBoundary", "((6.7-1)/6)^2 binary64 vs 0.9025 oracle.", {"j": 6.7}, {"weight": issuer_weight(6.7), "oracleDecimal": 0.9025, "withinTolerance": abs(issuer_weight(6.7) - 0.9025) <= TOLERANCE}),
        case("REP-08-10", "svriBoundary", "Score10 endpoints 1 to 0 and 7 to 10.", {"dimensions": [dimension(1.0, 3.0), dimension(7.0, 3.0)], "counts": [1, 1, 0, 0, 0]}, {"score10": [0.0, 10.0], "mean": 5.0}),
        case("REP-08-11", "svriBoundary", "Exact rational oracle metadata.", {"numerator": 70, "denominator": 13}, {"value": 70 / 13, "rational": {"numerator": 70, "denominator": 13}, "wireArithmetic": "binary64", "tolerance": TOLERANCE}),
        case("REP-08-12", "svriBoundary", "Score 7.0 with isInference=true.", {"dimensions": [dimension(5.2, 0.25)], "counts": [1, 0, 0, 0, 0]}, target(7.0, weight_sum=0.25)),
        case("REP-08-13", "svriBoundary", "Score 9.0 with incompleteData=true.", {"dimensions": [dimension(6.4, 3.0)], "counts": [0, 0, 6, 0, 6]}, target(9.0, weight_sum=3.0, t1=0, t2=0, t3=6, t5=6)),
        case("REP-08-14", "svriBoundary", "Exact boundary 7.0 with complete/non-inference flags.", {"dimensions": [dimension(5.2, 3.0)], "counts": [1, 0, 0, 0, 0]}, target(7.0)),
    ]
    return "REP-08 — Arithmetic and level boundaries", cases


def cap_case(actual, cap):
    return {"actual": actual, "cap": cap, "accepted": actual <= cap, "overCap": actual > cap,
            "status": "accepted" if actual <= cap else "limit_exceeded"}


def build_rep09():
    denominator_2 = math.lcm(6, 7)
    denominator_200 = math.lcm(*range(2, 201))
    cases = [
        case("REP-09-01", "workCap", "Exactly 2 unique evidence emitters.", {"actual": 2, "cap": 2}, cap_case(2, 2)),
        case("REP-09-02", "workCap", "3 unique evidence emitters.", {"actual": 3, "cap": 2}, cap_case(3, 2)),
        case("REP-09-03", "workCap", "200 reader-conduct candidates.", {"actual": 200, "cap": 200}, cap_case(200, 200)),
        case("REP-09-04", "workCap", "201 reader-conduct candidates.", {"actual": 201, "cap": 200}, cap_case(201, 200)),
        case("REP-09-05", "workCap", "16 history keys.", {"actual": 16, "cap": 16}, cap_case(16, 16)),
        case("REP-09-06", "workCap", "17 history keys.", {"actual": 17, "cap": 16}, cap_case(17, 16)),
        case("REP-09-07", "workCap", "400 history entries.", {"actual": 400, "cap": 400}, cap_case(400, 400)),
        case("REP-09-08", "workCap", "401 history entries.", {"actual": 401, "cap": 400}, cap_case(401, 400)),
        case("REP-09-09", "workCap", "640 signature attempts.", {"actual": 640, "cap": 640}, cap_case(640, 640)),
        case("REP-09-10", "workCap", "641 signature attempts.", {"actual": 641, "cap": 640}, cap_case(641, 640)),
        case("REP-09-11", "workCap", "2 emitters exactly at min_weight 2.0.", {"actualEmitters": 2, "cap": 2, "weightSum": 2.0, "minWeight": 2.0}, {"capPass": True, "minWeightPass": True, "independent": True}),
        case("REP-09-12", "workCap", "Rational denominator at max emitters (2).", {"denominators": [6, 7]}, {"denominatorBits": denominator_2.bit_length(), "requiresOwnerCap": True, "status": "pending_owner_cap"}),
        case("REP-09-13", "workCap", "Adversarial denominator growth at 200 candidates.", {"denominators": list(range(2, 201))}, {"denominatorBits": denominator_200.bit_length(), "requiresOwnerCap": True, "status": "pending_owner_cap", "bounded": False}),
    ]
    return "REP-09 — Caps, fan-out and denominator", cases


def hsvr_case(*, complete=True, missing_key=False, missing_jws=False, missing_anchor=False,
              version_mismatch=False, current_for_past=False, partial_high=False):
    if current_for_past:
        return {"status": "refused", "reason": "current_score_cannot_replace_past"}
    reasons = []
    if missing_key:
        reasons.append("missing_historical_key")
    if missing_jws:
        reasons.append("missing_attestation_jws")
    if missing_anchor:
        reasons.append("missing_anchor")
    if version_mismatch:
        reasons.append("rules_or_snapshot_mismatch")
    if reasons:
        return {"status": "partial", "reason": reasons[0], "fillWithCurrentScore": False}
    if partial_high:
        return {"status": "partial", "reason": "partial_history", "publicLevel": "pending"}
    return {"status": "complete", "sameScore": True}


def build_rep10():
    cases = [
        case("REP-10-01", "hsvrProvenance", "Complete historical reconstruction.", {"complete": True}, hsvr_case()),
        case("REP-10-02", "hsvrProvenance", "Missing historical key.", {"missingKey": True}, hsvr_case(missing_key=True)),
        case("REP-10-03", "hsvrProvenance", "Missing attestation/JWS.", {"missingJws": True}, hsvr_case(missing_jws=True)),
        case("REP-10-04", "hsvrProvenance", "Missing DNS/anchor.", {"missingAnchor": True}, hsvr_case(missing_anchor=True)),
        case("REP-10-05", "hsvrProvenance", "Rules/snapshot version mismatch.", {"versionMismatch": True}, hsvr_case(version_mismatch=True)),
        case("REP-10-06", "hsvrProvenance", "Reordered history events.", {"orders": [[5.0, 7.0], [7.0, 5.0]]}, {"sameResult": True, "score": 6.0}),
        case("REP-10-07", "hsvrProvenance", "Current score requested for a missing past event.", {"currentForPast": True}, hsvr_case(current_for_past=True)),
        case("REP-10-08", "hsvrProvenance", "Partial history with a high current score.", {"partialHigh": True}, hsvr_case(partial_high=True)),
    ]
    return "REP-10 — HSVR and provenance", cases


def build_rep11():
    source = json.loads((SPEC / "vectors/ltp/v0.1/svri-math.json").read_text())
    reference = [
        {
            "id": item["id"],
            "score": item["expected"]["projection"]["score"],
            "publicLevel": item["expected"]["publicLevel"],
        }
        for item in source["cases"]
    ]
    dims = [dimension(5.2, 3.0), dimension(4.0, 3.0)]
    cases = [
        case("REP-11-01", "differential", "Every svri-math reference case through apw-resolver and candidate.", {"references": reference}, {"withinTolerance": True, "countsExact": True, "levelsExact": True, "tolerance": TOLERANCE, "referenceCount": len(reference)}),
        case("REP-11-02", "differential", "Same signed snapshot through scoreSiteDimensions and candidate.", {"dimensions": dims, "counts": [1, 0, 0, 0, 0]}, {"projection": project(dims, 1, 0, 0, 0, 0), "candidate": "future", "reference": "python-oracle"}),
        case("REP-11-03", "differential", "Same input, different order/permutation.", {"orders": [dims, list(reversed(dims))]}, {"sameResult": True, "score": project(dims, 1, 0, 0, 0, 0)["score"]}),
        case("REP-11-04", "differential", "Independent person/language/backend (S4).", {"required": "independent"}, {"status": "pending-S4", "sameAuthorSufficient": False}),
        case("REP-11-05", "differential", "Random/adversarial inputs at caps.", {"dimensions": [dimension(1.0, 0.25), dimension(7.0, 3.0)], "counts": [1, 1, 0, 0, 0]}, {"projection": project([dimension(1.0, 0.25), dimension(7.0, 3.0)], 1, 1, 0, 0, 0), "withinTolerance": True}),
        case("REP-11-06", "differential", "Implementation revision/arithmetic mode/caps recorded.", {"requiredFields": ["implementationRevision", "arithmetic", "caps"]}, {"requiredFields": ["implementationRevision", "arithmetic", "caps"], "arithmetic": "binary64", "tolerance": TOLERANCE}),
        case("REP-11-07", "differential", "Signed-rational profile request.", {"profile": "signed-rational"}, {"status": "out_of_scope", "doNotCompareBytesToBinary64": True}),
    ]
    return "REP-11 — Differential and independent reproduction", cases


def build_families():
    builders = [build_rep01, build_rep02, build_rep03, build_rep04, build_rep05, build_rep06,
                build_rep07, build_rep08, build_rep09, build_rep10, build_rep11]
    families = []
    for builder in builders:
        title, cases = builder()
        family = title.split(" — ")[0]
        families.append({
            "format": "ltp-reputation-static-vector",
            "version": "0.1",
            "family": family,
            "title": title,
            "status": "static-oracle-target",
            "engineImplemented": False,
            "arithmetic": "binary64 + absolute 1e-9 tolerance; rationals are oracle metadata",
            "source": "LTP-S3-REPUTATION-MISSING-VECTORS.md",
            "cases": cases,
        })
    return families


def assemble():
    families = build_families()
    all_cases = []
    coverage = []
    files = {}
    for family in families:
        family_id = family["family"]
        filename = family_id.lower().replace("rep-", "rep-") + ".json"
        # Explicit, stable filenames: rep-01-issuer.json etc.
        names = {
            "REP-01": "rep-01-issuer.json", "REP-02": "rep-02-attestation.json",
            "REP-03": "rep-03-uniqueness.json", "REP-04": "rep-04-eligibility.json",
            "REP-05": "rep-05-reader-conduct.json", "REP-06": "rep-06-negatives.json",
            "REP-07": "rep-07-no-data.json", "REP-08": "rep-08-boundaries.json",
            "REP-09": "rep-09-caps.json", "REP-10": "rep-10-hsvr.json",
            "REP-11": "rep-11-differential.json",
        }
        filename = names[family_id]
        files[filename] = family
        for item in family["cases"]:
            all_cases.append(item["id"])
            coverage.append({
                "id": item["id"], "family": family_id, "file": filename,
                "kind": item["kind"], "description": item["description"],
            })
    assert len(all_cases) == 117, len(all_cases)
    assert len(set(all_cases)) == 117, "duplicate case id"
    coverage_doc = {
        "format": "ltp-reputation-coverage",
        "version": "0.1",
        "totalCases": 117,
        "families": [{"id": family["family"], "cases": len(family["cases"])} for family in families],
        "cases": coverage,
    }
    files["coverage.json"] = coverage_doc
    manifest = {
        "format": "ltp-reputation-static-vectors",
        "version": "0.1",
        "status": "pending-audit",
        "scope": "G4 static vectors only; TypeScript reputation engine not implemented",
        "authorization": "Owner authorized static JSON generation on 2026-10-24; engine remains blocked until these files are audited",
        "sourceMatrixCommit": "f90abdb0952031ab5fed6020dc19f92294417f88",
        "oracle": "python3 standard library, binary64; fixture-only, not a Portaless engine",
        "arithmetic": "binary64 + absolute 1e-9 tolerance; rationals are oracle metadata",
        "totalCases": 117,
        "engineImplemented": False,
        "fixtures": [
            {"file": name, "digest": digest(files[name]), "cases": len(files[name]["cases"]) if name != "coverage.json" else 117}
            for name in sorted(files)
        ],
    }
    files["manifest.json"] = manifest
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files = assemble()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.publish:
        for name, value in files.items():
            (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf8")
    if args.check:
        for name, value in files.items():
            frozen = json.loads((OUT / name).read_text())
            assert frozen == value, f"static reputation vector differs: {name}"
    print(json.dumps({
        "candidateDigest": digest(files["manifest.json"]),
        "families": 11,
        "cases": 117,
        "engineImplemented": False,
        "arithmetic": "binary64+tolerance",
    }, indent=2))


if __name__ == "__main__":
    main()
