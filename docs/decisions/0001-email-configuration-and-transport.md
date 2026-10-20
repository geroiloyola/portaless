# ADR 0001: Email configuration and transport boundary

- **Status:** Accepted
- **Decision date:** 2026-10-19
- **Scope:** Plugin capability `email:send` and its operator configuration. This
  does not decide the storage/encryption policy for every future node secret.

## Context

Portaless has two email use cases:

1. Authentication email (for example, email step-up codes), implemented through
   `packages/auth/src/email-sender.ts`.
2. Plugin-triggered transactional email, implemented through the
   `email:send` capability and configured by the site operator.

The plugin capability requires the core to select an operator-approved
template, validate the recipient, inject the site's configured `from`, apply a
per-plugin quota and dispatch through the site's selected provider. The auth
`EmailSender` is a separate abstraction and has a different lifecycle/config
contract.

## Decision

1. Keep site settings in the existing generic `site_settings` key/value store;
   do not create a second email-only settings table.
2. Keep the per-plugin quota in the existing `plugin_email_quota` table and its
   numbered schema migration. Do not rename the table solely for pluralization.
3. Keep the capability transport/configuration in `packages/email-transport`.
   Do not route plugin email through the auth `EmailSender`; auth step-up email
   remains a separate transport/use case.
4. Use blind delegation: a plugin may send only `{ template, to, data }`. The
   core chooses the approved template and injects the site's `from`.
5. The email provider token/password is not returned by the admin API. Only an
   admin can read the email configuration endpoint; the token is write-only in
   the UI. **At-rest encryption of the email token is deferred by explicit
   operator decision.** The current SQLite/D1 settings value and ordinary DB
   backups may contain the token in plaintext.
6. The daily quota default is 50 per plugin; the deployment operator may tune
   it with `PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT`. This is an operational limit,
   not a cryptographic cap.

## Consequences

- The KV store remains shared with other site settings and avoids parallel
  settings persistence code.
- The transport package can be consumed by the sandbox capability and admin
  API without making the sandbox depend on dashboard internals.
- A missing persistent quota backend fails closed; an in-memory counter is not
  accepted as a production quota.
- Auth email transport behavior can evolve without silently changing plugin
  email semantics.

## Known risks and incomplete controls

These are recorded limitations, not accepted security guarantees:

- Email credentials are **not encrypted at rest**. Protect the node's DB,
  volume, backups and operator access accordingly. Before offering a managed
  multi-tenant Cloudum service, define encryption-key custody and isolation;
  this ADR does not authorize sharing a DB or backup boundary between tenants.
- The admin PUT path currently preserves an existing token when the submitted
  token is blank. If the operator changes the webhook URL/provider at the same
  time, that token can be retained for the new destination. Resolve this before
  production use: bind credentials to provider identity/destination, or require
  a new token when that identity changes.
- `from` is syntax-validated as an email address, but the current implementation
  does not prove domain ownership. A provider may enforce this; Portaless does
  not currently verify it. Do not label the address “verified” without that
  evidence.
- An SMTP/webhook timeout can leave delivery outcome unknown (the provider may
  have accepted the message before the response was lost). Quota release is not
  proof that no message was delivered; delivery is not exactly-once.
- `PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT` can be set above 50. Deployments must
  choose a value appropriate to their provider and reputation risk.

## Rejected alternatives

- **Dedicated `site_settings_email` table:** duplicates the existing site
  settings persistence without a demonstrated query/schema need.
- **Rename quota table to `plugin_email_quotas`:** requires compatibility work
  for existing installations and offers no behavior improvement.
- **Reuse `packages/auth/src/email-sender.ts`:** that interface/configuration
  does not implement the plugin capability's DB configuration and site `from`
  contract. Unifying it would require a separate design, not an import change.
- **Encrypt email tokens now:** explicitly deferred by the operator for this
  iteration. This is a trade-off, not a claim that plaintext DB storage is
  equivalent to encryption.

## Revisit when

- Portaless begins serving multiple tenants from shared Cloudum infrastructure.
- Email credentials must be portable across hosts or protected from a
  compromised/backed-up database.
- A verified sender-domain workflow is added.
- The transport gains delivery IDs/idempotency and a reliable distinction
  between rejected and unknown outcomes.
