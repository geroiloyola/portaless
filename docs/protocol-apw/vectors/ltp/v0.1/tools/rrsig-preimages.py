"""Export dnspython's canonical signing bytes for OpenSSL CLI cross-checks."""
import base64
import hashlib
import json
from pathlib import Path
import dns.dnssec
import dns.message

root = Path(__file__).resolve().parent.parent
proofs = json.loads((root / "dnssec-proofs.json").read_text())
decode = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
out = []
for profile in proofs["profiles"].values():
    for item in profile["rrsets"]:
        message = dns.message.from_wire(decode(profile["messages"][item["wireIndex"]]))
        signature = message.answer[1][0]
        # Private API is pinned to dnspython 2.7.0; this is fixture tooling only.
        data = dns.dnssec._make_rrsig_signature_data(message.answer[0], signature)
        assert encode(hashlib.sha256(data).digest()) == item["signingInputDigest"]
        out.append({"message": encode(data), "signature": encode(signature.signature),
                    "jwk": item["publicKeyJwk"], "algorithm": profile["algorithm"]})
print(json.dumps(out))
