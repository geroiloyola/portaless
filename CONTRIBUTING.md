# Contributing to Portaless

> Canonical English version. The Spanish archive is [`CONTRIBUTING_es.md`](./CONTRIBUTING_es.md).

Thanks for your interest in contributing. Portaless is a young project (v0.0.x, MVP phase) — most modules are functional; check the real status table in [`AGENT.md`](./AGENT.md) and [`ROADMAP.md`](./ROADMAP.md) before assuming anything. Before contributing, read [`CHANGELOG.md`](./CHANGELOG.md) to understand what is really implemented and what is still design.

## How to contribute

1. Open an Issue before a large PR, to align on the approach.
2. Every new module must follow the "optional, not mandatory" principle — enabling a module (commerce, Trust Layer, sandboxing) must never break the site's behavior when it is disabled.
3. Any `TODO` you resolve must come with a test in `tests/unit/` or `tests/e2e/`.
4. Plugins must declare their capabilities in a manifest — never add implicit access to network, storage, or user data.
5. The Portaless core is licensed AGPL-3.0. The Protocol APW specification (`docs/protocol-apw/`) is published under CC BY 4.0 — spec changes are proposed as an issue or PR and follow the "Licencia y gobernanza" process of `APW-SPEC-v1.3.md` (errata vs. new version). The Plugin SDK (`packages/plugin-sdk`) is licensed separately under MIT, so third-party plugins consuming it are not restricted. See `docs/architecture/licensing-boundaries.md` for the exact boundary, and the "Licensing, the Plugin SDK, and the DCO" section below before contributing new code to either.

## Areas where help is most needed today

- **Report specification ambiguity** — if you implement Protocol APW (or LTP) and the text forced you to guess, open a [Specification ambiguity](./.github/ISSUE_TEMPLATE/spec_ambiguity.md) issue citing the section and the vectors. [`docs/VISION.md`](./docs/VISION.md) asks implementers to "say where the specification was ambiguous, because that is how a specification improves"; this channel is for exactly that, and it claims nothing more.
- **Be a reviewer** — the two highest-damage surfaces (how a person proves who they are, and how third-party code is contained) need a second pair of eyes; [`docs/security-review-guide.md`](./docs/security-review-guide.md) maps where they live and how to break them, and needs no commit rights. A second maintainer with real merge authority is the project's biggest structural gap ([`SECURITY.md`](./SECURITY.md)).
- Completing real integration of the edge sandboxing adapters (`packages/plugin-sandbox/src/adapters/deno-deploy.ts` and `cloudflare-workers-for-platforms.ts`) against real test accounts — today they are only verified with mocked `fetch`. The self-hosted `isolated-vm` adapter has run real code since v0.0.6.
- Testing `npm run setup` locally against a real SQLite file before trusting the install flow documented in `scripts/SETUP.md`.
- MCP server per-invocation agent identity (today it is per-process — see the known limitation in `AGENT.md`).
- AT Protocol identity (`packages/identity-atproto/` is still an empty stub — the only such package left).
- Documentation: English is now canonical; `*_es.md` archives stay frozen. If you touch a module, update the English docs first.

## Licensing, the Plugin SDK, and the DCO

Portaless has two licenses: the core (`functions/`, `src/`, every `packages/` except the SDK) is **AGPL-3.0** (`LICENSE`); the Plugin SDK (`packages/plugin-sdk`) is **MIT** (`packages/plugin-sdk/LICENSE`), so a closed-source plugin that imports it never incorporates AGPL code.

**Copyright ownership (recorded 2026-10-15).** The two commit identities in this repository's history — `geroiloyola` and `linstarkcorp` — are **the same copyright holder** (Linstark is the corporate entity behind the commercial layer; see `docs/architecture/ecosystem-boundaries.md`). This is stated explicitly because the SDK's MIT license is only clean if code moved from AGPL to MIT has a single holder, and a reviewer years later must not have to infer it. Verify against a full clone (this repository's own clone may be shallow and see only part of the history):

```sh
git log --format='%ae %an' | sort -u
git log --format='%ae' -- packages/plugin-sandbox/src/types.ts | sort -u
```

**One-way rule.** Only code whose copyright holder is the author crosses from the core (AGPL) to the SDK (MIT). The reverse direction — MIT-licensed SDK code reused inside the AGPL core — is fine: MIT is compatible with AGPL. Copying AGPL code into the MIT SDK is **not** allowed without the permission of every holder, which is what the check above establishes, file by file. The SDK re-declares its own types and catalog as its own document; equivalence with the core is guaranteed by a test on the AGPL side (`tests/unit/plugin-sdk-parity.test.ts`), not by a runtime import.

**DCO.** Contributions are accepted under the [Developer Certificate of Origin](./DCO): sign off every commit with `git commit -s` (`Signed-off-by: Name <email>`). The DCO certifies each contribution; it does **not**, by itself, authorize moving existing AGPL code to the MIT SDK — the ownership note above is what does that.

## Code of conduct

Be respectful, specific in your bug reports, and honest about limitations when proposing a feature — this project prioritizes clearly documenting what does not work yet over pretending everything is solved.
