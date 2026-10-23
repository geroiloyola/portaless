"""Read-only numeric cross-check with Python's authoring serializer (same author)."""
import json
from pathlib import Path
from author import canonical, unb64

root = Path(__file__).resolve().parent.parent
vectors = json.loads((root / "numeric-serialization.json").read_text())
def integer_tree(value):
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, (int, float)):
        return value == int(value) and abs(value) <= 9007199254740991
    return all(integer_tree(v) for v in (value.values() if isinstance(value, dict) else value))

for case in vectors["cases"]:
    value = json.loads(case["wire"])
    assert canonical(value) == case["canonical"], case["wire"]
    assert integer_tree(value) == case["signedInteger"]
for wire in vectors["rejectedSignedNumbers"]:
    assert not integer_tree(json.loads(wire))

# Reject decimal/exponent tokens too in existing signed payloads; none are needed.
def no_float(token):
    raise AssertionError("float token in signed payload: " + token)
signed = set()
def walk(value):
    if isinstance(value, str) and value.count(".") == 2:
        try:
            header, payload, signature = value.split(".")
            h = json.loads(unb64(header))
        except (ValueError, UnicodeError):
            return
        if isinstance(h, dict) and h.get("alg") == "EdDSA":
            p = json.loads(unb64(payload), parse_float=no_float)
            assert integer_tree(p)
            signed.add(value)
    elif isinstance(value, dict):
        for v in value.values(): walk(v)
    elif isinstance(value, list):
        for v in value: walk(v)
manifest = json.loads((root / "manifest.json").read_text())
for entry in manifest["fixtures"]:
    walk(json.loads((root / entry["file"]).read_text()))
print(json.dumps({"numericCases": len(vectors["cases"]), "signedJwsScanned": len(signed),
                  "signedFloatTokens": 0, "discrepancies": []}))
