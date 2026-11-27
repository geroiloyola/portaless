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
| [0003 — Public and governed resource contract](./0003-public-and-governed-resource-contract.md) | Separate public projections from dynamically authorized resources; owner-approved D1–D9 resolution baseline, independent bootstrap and restrictive budget | Architecture/contracts approved; documentary merge required before Edge programming; final protocol publication and runtime acceptance pending |
| [0004 — Self-host Node 24 runtime](./0004-self-host-node-runtime.md) | Run Astro static output + `functions/` via a Node 24 HTTP runtime for self-hosting | Accepted |
| [0005 — First-run trust root](./0005-first-run-trust-root.md) | Allow one-time first-admin creation only on a clean self-hosted volume with bootstrap guard | Accepted |
| [0006 — Generated volume secrets](./0006-generated-volume-secrets.md) | Use env `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` when set, else generate 32-byte key on data volume | Accepted |
| [0007 — Container packaging](./0007-container-packaging.md) | Multi-stage `node:24-bookworm-slim` Dockerfile excluding host `node_modules` and `dist` | Accepted |
