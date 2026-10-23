#!/usr/bin/env python3
"""Same-author harness around third-party dnspython; RRset checks, not a validator."""
import base64
import json
from pathlib import Path
import dns
import dns.dnssec
import dns.exception
import dns.message
import dns.name
import cryptography
from cryptography.hazmat.backends.openssl.backend import backend

root = Path(__file__).resolve().parent.parent
proofs = json.loads((root / "dnssec-proofs.json").read_text())
decode = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
checks = 0
for profile in proofs["profiles"].values():
    messages = [dns.message.from_wire(decode(s)) for s in profile["messages"]]
    for index, message in enumerate(messages):
        key = messages[0 if index < 2 else 2].answer[0]
        keys = {key.name: key}
        rrset, signatures = message.answer
        dns.dnssec.validate(rrset, signatures, keys, now=1790000010)
        checks += 1
        # Library must reject a real one-bit signature mutation, not just accept originals.
        wire = bytearray(decode(profile["messages"][index]))
        wire[-1] ^= 1
        damaged = dns.message.from_wire(bytes(wire))
        try:
            dns.dnssec.validate(damaged.answer[0], damaged.answer[1], keys, now=1790000010)
        except dns.dnssec.ValidationFailure:
            pass
        else:
            raise AssertionError("dnspython accepted damaged RRSIG")
        for time in proofs["signatureTimeCases"]:
            try:
                dns.dnssec.validate(rrset, signatures, keys, now=time["now"])
                valid = True
            except dns.dnssec.ValidationFailure:
                valid = False
            assert valid == time["valid"], "RRSIG time-boundary discrepancy"
print(json.dumps({"tool": "dnspython", "version": dns.__version__,
                  "primitiveBackend": backend.openssl_version_text(),
                  "cryptography": cryptography.__version__, "rrsigs": checks,
                  "mutationsRejected": checks, "boundaryChecks": checks * 4,
                  "discrepancies": [], "delegationChainValidated": False}))
