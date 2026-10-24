# Specification extraction plan — prepare only

**Status:** Draft, no extraction executed or authorized. **License:** CC BY 4.0.

## Proposed specification repository contents

- APW adopted identity/structure specification, errata and historical versions.
- LTP core contracts, role/profile definitions, identifier registry and security
  assumptions; optional SVRI/HSVR profiles kept visibly separate.
- Versioned JSON schemas and their manifest, immutable original JWS/DNS fixtures,
  corpus/numeric-extension manifests and documented coverage blockers.
- Standalone authoring/cross-check tools, their own package/lock and Python
  requirements, CC BY 4.0 notices and third-party dependency license notices.
- Governance, contribution/errata process, conformance results with actual author,
  reviewer and implementation identities, release provenance and changelog.
- A clearly marked **implementación de referencia** appendix may link to
  implementations; normative sections must not depend on their source trees.

Exclude runtime, deployment secrets, databases, adapters, site content and grant
stores. This document creates no new repository, remote, submodule or package
publication and renames nothing.

## Prepared boundary in this tree

The [standalone package](./package.json) owns Ajv, canonicalize, JOSE and all asset
scripts, with its own lockfile; [Python requirements](./requirements-audit.txt)
pin the DNSSEC tooling. It imports no Portaless code. It is intentionally not a
Portaless workspace package. Installing root runtime dependencies alone does not
install it. CI installs it explicitly and runs link-boundary/standalone tests.

```bash
npm ci --prefix docs/protocol-apw --ignore-scripts
python3 -m venv /tmp/ltp-audit
/tmp/ltp-audit/bin/python -m pip install -r docs/protocol-apw/requirements-audit.txt
LTP_PYTHON=/tmp/ltp-audit/bin/python npm test --prefix docs/protocol-apw
npm run audit --prefix docs/protocol-apw
python3 docs/protocol-apw/vectors/ltp/v0.1/tools/author.py --check
```

The link lint scans Markdown inline/reference links and HTML/autolinks beneath
the specification tree. Runtime targets are allowed only under a level-2 heading
`Apéndice: implementación de referencia`, until the next level-1/2 heading.
Quoted historical source paths are descriptive text, not normative dependencies.

## Versioning and Portaless digest pinning (future execution)

1. Owner approves complete S1/S3 coverage and exact digests, then S4/S6 evidence.
   Draft snapshots use prerelease versions; no `latest` or mutable URL is a pin.
2. Publish immutable release archives with a file-byte SHA-256 manifest and the
   existing schema/corpus JCS commitments, license and signed release provenance.
   Archive byte digests and parsed-JSON JCS digests are different commitments.
3. A future reviewed Portaless change vendors or downloads an **exact** approved
   release and records repository URL, tag/commit, archive SHA-256, schema bundle
   digest, corpus digest, numeric-extension digest and supported profile versions
   in a pin file. Verify before consuming assets; fail on a mismatch, never fetch
   an untrusted `$ref` or regenerate expectations with the implementation.
4. CI runs the pinned vectors against Portaless separately from the spec tooling.
   Upgrades require a PR explaining semantic/digest changes and negative results;
   corrections preserve old snapshots and use versioned errata.

No pin file or release is claimed to exist yet. Naming/collision decisions and
the outstanding S3 coverage block approval; S4 needs another person's verifier.
