# ADR 0002: Egress validation and DNS rebinding

- **Status:** Accepted
- **Decision date:** 2026-10-21
- **Scope:** Webhook and SMTP destinations configured by an operator, and the
  capability that sends transactional email. It does not decide the network
  policy of a hosting provider.

## Context

Portaless lets an operator configure an HTTP webhook or SMTP relay for
transactional email. That destination is server-side egress: a malicious or
mistaken configuration could target loopback, private networks, link-local
metadata (`169.254.169.254`) or an internal Docker service.

The current code already:

- rejects loopback, `.local`, `.internal`, private IPv4, CGNAT, link-local and
  IPv6 ULA/link-local literals;
- canonicalizes IPv4-mapped IPv6 (for example `[::ffff:127.0.0.1]`, which the
  WHATWG URL parser rewrites to `[::ffff:7f00:1]`) and rejects the mapped
  private address;
- requires HTTPS when a webhook carries a credential;
- sets `redirect: "manual"` for webhooks and rejects every 3xx response, so a
  public URL cannot redirect the server to a private destination;
- resolves no DNS itself for webhook safety; the platform resolver does.

The remaining gap is **DNS rebinding**: a hostname can resolve to a public
address during validation and to a private address at send time. The code
comment already names this as defense-in-depth, not a complete SSRF boundary.
SMTP has the same class of risk because `normalizeEmailHost` validates syntax
and literal ranges, not the address the resolver returns.

## Decision

For the Beta:

1. Keep the literal-address checks, the HTTPS-with-credential rule and the
   no-redirect webhook policy.
2. Do **not** add a second DNS resolution layer inside the application yet.
   Node and the hosting platform already resolve the destination; adding a
   custom pinning layer would create a new failure mode without a testable
   provider contract.
3. Treat egress control as an **operator/hosting responsibility** for
   high-assurance deployments: restrict the container/service egress to the
   destinations the operator approved, and do not expose the metadata service.
4. Keep the local Docker staging fixture on an internal network with fake
   services; it must not gain general internet egress for tests.

## Consequences

- A configured webhook/SMTP hostname that rebinds from a public to a private
  address is not fully blocked by the application. This is a documented residual
  risk, not an accepted guarantee.
- Operators who need a stronger boundary must enforce it at the network layer
  (egress allowlist, DNS policy, metadata blocking, private network ACLs).
- A future managed service (Cloudum or another provider) must state its egress
  and DNS policy; it cannot inherit a guarantee this ADR does not make.

## Revisit when

- Portaless offers a managed multi-tenant egress path.
- A provider exposes a resolver-pinning or connection-pinning contract that can
  be tested.
- A real incident or a reproducible rebinding test shows the residual risk is
  not acceptable for the Beta.

## Related documents

- [`../architecture/authentication.md`](../architecture/authentication.md) — auth email delivery.
- [`../self-hosting.md`](../self-hosting.md) — operator network guidance.
- [`../testing/disposable-staging.md`](../testing/disposable-staging.md) — internal-network fixture.
