# Portaless Security Policy

> Canonical English version. The Spanish archive is [`SECURITY_es.md`](./SECURITY_es.md).

## Reporting a vulnerability

Do not open a public issue to report a vulnerability. Contact the maintainers privately through the project's configured contact channel and include:

- description and potential impact;
- affected version and component;
- steps to reproduce;
- proof of concept, if available;
- proposed mitigation, if you have one.

Do not publish exploitation details until an assessment and coordinated disclosure have happened.

## Security status

Portaless is an alpha / MVP under active development. It must not be considered production-ready, nor used with sensitive data, without an independent review and validation of the deployment environment.

Areas that require special attention:

- authentication, MFA/TOTP, sessions and OAuth/SSO;
- password recovery and persistence of its tokens;
- plugin sandbox isolation and limits;
- permissions, especially `content:write`;
- self-hosted and edge execution adapters;
- npm dependencies and supply-chain vulnerabilities;
- Cloudflare, SQLite, and deployment secret configuration.

## Bus factor (single-maintainer risk)

Portaless has **one human point of failure**: a single author with merge
permissions and the only deep knowledge of the codebase. This is a
documented risk, not a hidden one — Phase 3 of the
[Beta roadmap](./ROADMAP.md) requires an **explicit decision** before the
public Beta invites third-party production data:

> A project with a single human point of failure should not invite
> third-party production data without that minimal safeguard, in honesty
> with whoever trusts it.

The decision to make (and record here when made): **is a second
maintainer with real merge permissions sought before opening the Beta, or
is the Beta deferred until one exists?** Options the author may weigh:

1. **Seek a second maintainer first** — slowest, strongest; the Beta
   waits until someone outside the author can review and merge.
2. **Open the Beta with a documented single-maintainer notice** — every
   operator is told plainly that there is no second reviewer; acceptable
   only if the operator audience accepts that risk consciously (e.g.
   hobby/self-hosted use, not third-party production data).
3. **Hybrid** — Beta opens to trusted/known operators only (invite),
   public signups wait for a second maintainer.

Status: **pending decision.** When decided, this section is updated with
the choice, the date, and (for option 1) the process used to find the
second person. The companion review item — a minimal external security
review of the auth flow and plugin sandbox — is mapped in
[`docs/security-review-guide.md`](./docs/security-review-guide.md) so a
second pair of eyes has a concrete starting point.

## Minimum operational requirements

Before a public deployment:

- store secrets in environment variables or a secret manager;
- never commit `.env` files, databases, private keys, or certificates;
- use `npm ci` and keep `package-lock.json` up to date;
- run the build, the tests, and the dependency audit;
- apply rate limiting to login, MFA, and password recovery;
- set `Secure`, `HttpOnly`, and `SameSite` cookies where applicable;
- validate `state`, PKCE, and redirect URLs in OAuth;
- use shared persistence for sessions and recovery in distributed deployments;
- validate manifests and grant capabilities with a deny-by-default policy;
- limit memory, CPU, execution time, and network output for each plugin;
- review every third-party plugin as untrusted code.

## Secrets and sensitive data

The repository contains example files, not production secrets. Before publishing or deploying, run a secret scanner over the tree and, where applicable, over the history. If a credential is found, revoke and rotate it before attempting to clean the history.

Never enable `PORTALESS_DEV_MODE` in production: that option can return recovery tokens in the HTTP response.

## CI controls

Continuous integration must block changes when these fail:

- reproducible install with `npm ci`;
- production build;
- automated tests;
- `npm audit --audit-level=high`;
- manifest validation and secret scanning.

An audit result must not be silenced with `|| true` unless there is a documented, scoped, reviewed exception with an expiration date.

## Scope and limitations

This policy describes the project's process and security expectations; it is not a security guarantee nor a certification. Final security also depends on configuration, the infrastructure provider, dependencies, installed plugins, and the deployment's operational controls.

Architecture documentation and the roadmap may contain experimental or pending functionality. Do not assume a feature is production-ready just because its file or interface exists.
