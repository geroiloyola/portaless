# Architecture decision records

This directory records accepted product and architecture decisions, including
their scope, consequences, known risks and conditions for reconsideration.
An ADR describes the decision at the time it was accepted; it does not claim
that every implementation consequence is already complete. Current code status
remains in [`ROADMAP.md`](../../ROADMAP.md); release evidence and the external
gates are in [`testing/release-acceptance.md`](../testing/release-acceptance.md).
An ADR being accepted is not evidence that its remaining risks are closed.

| ADR | Decision | Status |
|---|---|---|
| [0001 — Email configuration and transport boundary](./0001-email-configuration-and-transport.md) | Keep email configuration in the shared `site_settings` KV store, quota in `plugin_email_quota`, use `email-transport` separately from auth email, and defer at-rest encryption for email credentials | Accepted; listed implementation risks remain |
| [0002 — Egress validation and DNS rebinding](./0002-egress-dns-rebinding.md) | Keep literal-address checks and the no-redirect webhook policy; treat DNS rebinding and SMTP resolution as an operator network boundary for the Beta | Accepted; residual DNS-rebinding risk documented |
| [0003 — Public and governed resource contract](./0003-public-and-governed-resource-contract.md) | Separate public projections from dynamically authorized resources; define route-family behavior before implementing the automated-reader gate | Proposed for owner review; no enforcement change in PR1 |
