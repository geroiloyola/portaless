# Glossary

This is the shared vocabulary for Portaless and Protocol APW. It exists because
the same concepts appear in the README, the changelog, the spec and the admin
UI; a reader should not have to infer them from context.

| Term | Meaning |
|---|---|
| **APW** | Protocol APW: the open identity, trust and discovery protocol documented in [`protocol-apw/APW-SPEC-v1.3.md`](./protocol-apw/APW-SPEC-v1.3.md). |
| **LTP** | Loyal Trust Protocol: the scoring model inside APW (Annex A). It produces per-dimension W scores for sites and R scores for readers. |
| **Veranet** | The end state where independent APW sites and indexes can verify each other without a central authority. It is a direction, not a shipped network. |
| **Veracier** | A person or agent that signs community attestations with its own `did:apw`. The name is used for the emitter role; the UI for becoming one is not built. |
| **Cloudum** | An external hosting/operations provider for private Portaless nodes. It is not part of this repository and its operator controls are not verified here. |
| **`did:apw`** | The site's decentralized identifier, bound to a domain and a published Ed25519 key history. |
| **`did.json`** | The public DID document at `/.well-known/did.json`; it publishes the active key and optional AT Protocol links. |
| **SVRI** | Site Verifiable Reputation Index v1.0: the versioned projection that maps APW source tiers and prior contribution to a site-level score and a qualitative public level. |
| **HSVR** | Historical SVRI Reconstruction: the admin-only replay of the APW log that reconstructs how the score moved over time. It is bounded by the evidence that still verifies. |
| **T1–T5** | APW source tiers used by SVRI: T1 escrow report, T2 signed self-attestation, T3 signed community attestation, T4 reader-conduct activity, T5 signed agent automation. |
| **W / R dimensions** | LTP dimensions for a site (W-01…W-10) and a reader (R-01…R-05). Public projections expose only the dimensions the policy allows. |
| **`reader_conduct`** | A signed record that a reader respected the site's access policy. It feeds T4/R, not the site's W score. |
| **Score honesty** | The rule that a missing observation is shown as `no_data`/`Sin datos`, never as a neutral score, a zero, or a fabricated default. |
| **Source tier / evidence tier** | The APW classification of who signed an observation. Tier counts are not interchangeable; T1 is not "more true" than T2 by itself. |
| **Fail-closed** | A missing, corrupt or newer-than-code state blocks the operation (often `503`) instead of silently degrading. |
| **Canonical node** | The one active writer for a site's private content, revisions, archive and credentials. |
| **Public projection** | The allowlisted, generated public output (for example Git/GitHub Pages) derived from approved revisions; it is not the private canon. |
| **Single-writer** | The rule that only one node may accept writes at a time; backups and restored copies are not concurrent writers. |

## Related documents

- [`VISION.md`](./VISION.md) — direction and the evidence-first principle.
- [`protocol-apw/APW-SPEC-v1.3.md`](./protocol-apw/APW-SPEC-v1.3.md) — normative protocol.
- [`protocol-apw/SVRI-v1.0.md`](./protocol-apw/SVRI-v1.0.md) — SVRI/HSVR profile.
- [`mvp/acceptance-contract.md`](./mvp/acceptance-contract.md) — product acceptance contract.
