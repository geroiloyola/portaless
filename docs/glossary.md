# Glossary

This is the shared vocabulary for the **Vera Trust Stack** and its Portaless reference runtime. It exists because
the same concepts appear in the README, the changelog, the spec and the admin
UI; a reader should not have to infer them from context.

| Term | Meaning |
|---|---|
| **Vera Trust Stack** | The trust-centered stack under `verared`: APW identity/state structure → Local Trust Protocol evidence/traceability evaluation → SVRI output → HSVR historical output. See [`LTP-STACK-ARCHITECTURE.md`](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/LTP-STACK-ARCHITECTURE.md). |
| **APW** | Identity and structural layer: `did:apw`, domain/key binding, signed artifacts and state-transition/log structure used for peer exchange. The currently published [`APW v1.3`](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/APW-SPEC-v1.3.md) document also contains the existing Local Trust Protocol contracts; file organization does not make identity alone a trust result. |
| **LTP** | **Local Trust Protocol**: each node applies its own local policy to verified evidence. Its deterministic core audits history, signatures, evidence and witnesses; versioned profiles can derive W dimensions for sites or R dimensions for readers. It is not a global authority or an automatic resource grant. In live prose, spell out **Local Trust Protocol** (avoid standalone `LTP` to prevent collision with Linux Test Project and RFC 5326). |
| **Witness Index** | A neutral trust-proof discovery/distribution role, not an identity or reputation authority. The [Draft 0.1 contract](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/LTP-INDEX-DRAFT-v0.1.md) is not yet implemented; the current witness directory retains its historical `apw-index` format. Portaless product documentation refers to its node implementation as **Portaless Index**. |
| **Proof Package** | The proposed neutral [container of APW identity/state proofs and Local Trust Protocol evidence](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/LTP-PROOF-PACKAGE-DRAFT-v0.1.md) for independent verification. Index signatures alone do not verify its contents. |
| **Verared** | The neutral foundation/network direction where independent APW sites and witness indexes can verify each other without a central authority. It is a direction, not a shipped network. (Unifies live mentions of the earlier name; *"Veranet Universal Scoring System"* is preserved only in Annex A as historical attribution.) |
| **`community attester`** | Normative role for a domain/operator that signs community attestations with its own `did:apw`. Portaless product UX and routes (`/trust/veracier/*`) call this role **Veracier**; the UI for becoming one is not built. |
| **Cloudum** | An external hosting/operations provider for private Portaless nodes. It is not part of this repository and its operator controls are not verified here. |
| **`did:apw`** | The site's decentralized identifier, bound to a domain and a published Ed25519 key history. |
| **`did.json`** | The public DID document at `/.well-known/did.json`; it publishes the active key and optional AT Protocol links. |
| **SVRI** | The versioned consumable output vector of Local Trust Protocol: score where applicable, qualitative level, provenance and incomplete/inference flags. Public/admin fields follow [SVRI v1.0](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/SVRI-v1.0.md); missing evidence stays pending. |
| **HSVR** | The verifiable historical record of SVRI outputs, retained with snapshot/time/rules/proof references or reconstructed from verifiable APW evidence. The current contract exposes authorized administrative reconstruction, not an assertion that all outputs already have persistent snapshots. |
| **T1–T5** | Local Trust Protocol evidence-provenance tiers expressed by SVRI over signed APW observations: T1 escrow report, T2 signed self-attestation, T3 signed community attestation, T4 reader-conduct activity, T5 signed agent automation. |
| **W / R dimensions** | Local Trust Protocol dimensions for a site (W-01…W-10) and a reader (R-01…R-05). Public projections expose only the dimensions the policy allows. |
| **`reader_conduct`** | A signed record that a reader respected the site's access policy. It feeds T4/R, not the site's W score. |
| **Score honesty** | The rule that a missing observation is shown as `no_data`/`Sin datos`, never as a neutral score, a zero, or a fabricated default. |
| **Source tier / evidence tier** | The APW classification of who signed an observation. Tier counts are not interchangeable; T1 is not "more true" than T2 by itself. |
| **Fail-closed** | A missing, corrupt or newer-than-code state blocks the operation (often `503`) instead of silently degrading. |
| **Canonical node** | The one active writer for a site's private content, revisions, archive and credentials. |
| **Public projection** | The allowlisted, generated public output (for example Git/GitHub Pages) derived from approved revisions; it is not the private canon. |
| **Single-writer** | The rule that only one node may accept writes at a time; backups and restored copies are not concurrent writers. |

**Acronym collision:** [RFC 5326](https://www.rfc-editor.org/rfc/rfc5326.html)
uses LTP for Licklider Transmission Protocol (and Linux Test Project also uses
LTP), unrelated to this protocol. Here the unique expansion is **Local Trust
Protocol**, and **Vera Trust Stack** denotes APW + Local Trust Protocol + SVRI + HSVR.

## Related documents

- [`VISION.md`](./VISION.md) — direction and the evidence-first principle.
- [`protocol-apw/APW-SPEC-v1.3.md`](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/APW-SPEC-v1.3.md) — normative protocol.
- [`protocol-apw/SVRI-v1.0.md`](https://github.com/verared/vera-trust-spec/blob/v0.1.0-draft.1/spec/SVRI-v1.0.md) — SVRI/HSVR profile.
- [`mvp/acceptance-contract.md`](./mvp/acceptance-contract.md) — product acceptance contract.
