# LTP expansion inventory — owner naming decision

Snapshot **before edits**, commit `4faeccd4b2cefbb7b67667421755c34a2bde1cc6`.
Query: `Loyal Trust|Loyola Trust|Local Trust|LTP \(` (case-sensitive).
Scope: all docs, root README/AGENT/CHANGELOG/ROADMAP Markdown, all source/site
texts, package READMEs and public text. The full repository search returned the
same **24 matching lines**; a row includes every matching expansion on that line.
Line numbers below identify the snapshot, not the subsequently edited file.

Classes: **(a)** live text to correct; **(b)** archive/version history, unchanged;
**(c)** identifier/signed bytes, unchanged. Existing continuity notes in live
files are (a): update the current expansion and retain former names only as history.

<!-- ltp-history:start -->
| File:line at snapshot | Matched text | Class / action |
|---|---|---|
| `docs/glossary.md:11` | Loyal Trust Protocol | (a) unique current expansion and local-policy meaning |
| `docs/protocol-apw/APW-SPEC-v1.3.md:7` | Loyal Trust Protocol | (a) live status/header |
| `docs/protocol-apw/APW-SPEC-v1.3.md:26` | Loyola Trust Protocol; Loyal Trust Protocol | (b) frozen v1.2 history row; retain the names used by that historical edition |
| `docs/protocol-apw/APW-SPEC-v1.3.md:46` | Loyal Trust Protocol; Loyola Trust Protocol | (a) name/continuity note; replace current name, record both former expansions |
| `docs/protocol-apw/APW-SPEC-v1.3.md:322` | Loyal Trust Protocol | (a) section 6 heading; retain legacy heading anchor separately |
| `docs/protocol-apw/APW-SPEC-v1.3.md:330` | Loyal Trust Protocol | (a) section 6 concept |
| `docs/protocol-apw/APW-SPEC-v1.3_es.md:11` | Loyal Trust Protocol | (b) Spanish archival copy |
| `docs/protocol-apw/APW-SPEC-v1.3_es.md:21` | Loyola Trust Protocol; Loyal Trust Protocol | (b) archival version history |
| `docs/protocol-apw/APW-SPEC-v1.3_es.md:35` | Loyal Trust Protocol; Loyola Trust Protocol | (b) archival naming note |
| `docs/protocol-apw/APW-SPEC-v1.3_es.md:304` | Loyal Trust Protocol | (b) archival section heading |
| `docs/protocol-apw/APW-SPEC-v1.3_es.md:312` | Loyal Trust Protocol | (b) archival concept |
| `docs/protocol-apw/APW-SPEC-v1.2.md:8` | Loyola Trust Protocol | (b) superseded specification |
| `docs/protocol-apw/APW-SPEC-v1.2.md:16` | Loyola Trust Protocol | (b) superseded version history |
| `docs/protocol-apw/APW-SPEC-v1.2.md:147` | Loyola Trust Protocol | (b) superseded section heading |
| `docs/protocol-apw/APW-SPEC-v1.2.md:155` | Loyola Trust Protocol | (b) superseded concept |
| `docs/protocol-apw/README.md:75` | Loyal Trust Protocol; Loyola Trust Protocol | (a) live overview/license and continuity |
| `docs/protocol-apw/README_es.md:18` | Loyal Trust Protocol; Loyola Trust Protocol | (b) Spanish archival overview |
| `docs/protocol-apw/LTP-STACK-ARCHITECTURE.md:208` | Loyal Trust Protocol | (a) collision review; naming decision is now recorded |
| `docs/architecture/site-trust-score.md:156` | Loyal Trust Protocol | (a) live module reference |
| `packages/apw-resolver/README.md:12` | Loyal Trust Protocol | (a) live package overview |
| `src/pages/trust/explicacion-svri.astro:15` | Loyal Trust Protocol | (a) live rendered page |
| `CHANGELOG.md:279` | Loyal Trust Protocol; Loyola Trust Protocol | (b) released v0.0.10 entry, not today's expansion |
| `CHANGELOG.md:312` | LTP (SiteTrustScore, witnesses, calibration) | (b) released entry; parenthesis describes components, not an expansion |
| `CHANGELOG_es.md:17` | Loyal Trust Protocol; Loyola Trust Protocol | (b) frozen Spanish changelog |
<!-- ltp-history:end -->

Totals: **10 (a), 14 (b), 0 (c) matching lines**. No pre-edit matches for the
new expansion, or in root README/AGENT/ROADMAP files, other source/site texts,
or schema/vector JSON. No identifier or signed payload matched this query.
Identifiers such as `ltp-svri-site-v1`, `ltp-proof-package`, `typ`, DID strings and
paths are not prose expansions and must not be renamed. The legacy section-6
anchor is preserved as an explicit identifier even though it contains the old
name in hyphenated lowercase (outside this query).

## Live naming rule after the decision

LTP means **Local Trust Protocol**: each node applies its own policy to verified
evidence. **LTP Stack** is APW + LTP + SVRI + HSVR. Attribution to Gerardo Loyola
remains in authorship and Annex A. This is an editorial name/meaning clarification,
not a change to formulas, keys, signed bytes, profiles, routes or protocol scope.

CI checks live documents/site text and permits former expansions only in marked
continuity/history notes or classified archival files/released changelog sections.
The snapshot above is a historical inventory, not an alternative naming policy.
