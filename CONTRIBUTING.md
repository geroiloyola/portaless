# Contributing to Portaless

> Canonical English version. The Spanish archive is [`CONTRIBUTING_es.md`](./CONTRIBUTING_es.md).

Thanks for your interest in contributing. Portaless is a young project (v0.0.x, MVP phase) — most modules are functional; check the real status table in [`AGENT.md`](./AGENT.md) and [`ROADMAP.md`](./ROADMAP.md) before assuming anything. Before contributing, read [`CHANGELOG.md`](./CHANGELOG.md) to understand what is really implemented and what is still design.

## How to contribute

1. Open an Issue before a large PR, to align on the approach.
2. Every new module must follow the "optional, not mandatory" principle — enabling a module (commerce, Trust Layer, sandboxing) must never break the site's behavior when it is disabled.
3. Any `TODO` you resolve must come with a test in `tests/unit/` or `tests/e2e/`.
4. Plugins must declare their capabilities in a manifest — never add implicit access to network, storage, or user data.
5. The Portaless core is licensed AGPL-3.0. The Protocol APW specification (`docs/protocol-apw/`) is published under CC BY 4.0 — spec changes are proposed as an issue or PR and follow the "Licencia y gobernanza" process of `APW-SPEC-v1.3.md` (errata vs. new version). The Plugin SDK (`packages/plugin-sdk`) will be licensed separately under MIT, so third-party plugins consuming it are not restricted. See `docs/architecture/licensing-boundaries.md` for the exact boundary before contributing new code to either.

## Areas where help is most needed today

- Completing real integration of the edge sandboxing adapters (`packages/plugin-sandbox/src/adapters/deno-deploy.ts` and `cloudflare-workers-for-platforms.ts`) against real test accounts — today they are only verified with mocked `fetch`. The self-hosted `isolated-vm` adapter has run real code since v0.0.6.
- Testing `npm run setup` locally against a real SQLite file before trusting the install flow documented in `scripts/SETUP.md`.
- MCP server per-invocation agent identity (today it is per-process — see the known limitation in `AGENT.md`).
- AT Protocol identity (`packages/identity-atproto/` is still an empty stub — the only such package left).
- Documentation: English is now canonical; `*_es.md` archives stay frozen. If you touch a module, update the English docs first.

## Code of conduct

Be respectful, specific in your bug reports, and honest about limitations when proposing a feature — this project prioritizes clearly documenting what does not work yet over pretending everything is solved.
