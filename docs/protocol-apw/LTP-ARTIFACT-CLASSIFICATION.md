# LTP artifact classification — one-page Draft review

**Status:** proposal for owner review, 2026-10-23. **License:** CC BY 4.0.
Classes: **(a)** deterministic LTP core and its APW proof dependency;
**(b)** optional versioned scoring/output profile; **(c)** Portaless runtime.
An artifact's protocol contract and its hosted implementation are distinct.

| Artifact | Class / exact boundary | Needed by PR3 grant-only MVP? |
|---|---|---|
| LTP Index | **(a)** neutral discovery/relay contract; **(c)** hosting, HTTP acquisition, cache, ingress, quotas and persistence | **No** new Index service required for grant-only identity. If indexed acquisition is selected, its complete contract applies; never a new trust authority. |
| LTP Proof Package | **(a)** deterministic proof container; selected scored Calculation is **(b)** | **No** as a mandatory new wire dependency. Direct APW identity acquisition can use A/B. Required if that optional package transport is selected. |
| `ltp-resolution-request` | **(a)** version/profile/request binding; admission/deadlines are **(c)** | **No** for direct A/B; yes when using the new Index contract. |
| `ltp-resolution-result` | **(a)** candidate/error envelope, not a trusted verdict; HTTP mapping is transport integration | **No** for direct A/B; yes when using the new Index contract. |
| SVRI Projection | **(b)** `ltp-svri-site-v1` rules/output; visibility/enforcement is **(c)** | **No** scoring prerequisite for explicit grants. Existing public projection obligations are preserved; no new reputation admission. |
| HSVR | **(b)** versioned historical reconstruction semantics; storage/retention/admin views are **(c)** | **No**; grant-only does not require retaining scored histories. Not the APW identity log. |
| APW Identity Bootstrap | **(a)** APW root/key dependency consumed by core; configured DoH/library adapter is **(c)** | **Yes**, authenticated identity/key continuity for the requesting reader; grant lookup is still a separate runtime authorization step. |

**A and B can advance without standardizing the Index.** A (TXT/DoH) and B
(`did.json`/history) bound existing APW identity acquisition; their shared budget,
SSRF/TLS negatives and controlled measurements need no new Index envelope or
scoring profile. This is a dependency finding, **not permission to start them
in this S1/S3 PR**. Permissions are defined only by the canonical register linked
below; no corpus acceptance or dependency finding authorizes implementation.

The [approved A → B → C gate](../architecture/resolution-chain-proposal.md)
still precedes PR3 because the public AT Protocol bridge can reach evidence.
Grant-only does not cancel C or silently remove that route. C's runtime-evidence
safety acceptance and eventual Index standard publication are separate gates;
any change to the approved sequence requires an owner decision. This table does
not enable PR3, R-05 or a new numeric reader reputation requirement.

This classification grants no permission. The [coverage matrix](./LTP-S3-COVERAGE.md)
supports G1 review; authorization scopes and states are defined only by
[LTP-GATES-AND-AUTHORIZATIONS.md](./LTP-GATES-AND-AUTHORIZATIONS.md).
