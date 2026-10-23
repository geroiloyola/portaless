# PR2: versioned resolution-budget configuration

Migration v10 creates `resolution_budget_config` without inserting a row, so
existing installations retain their current request behavior. The authenticated
admin API `GET/PUT /admin/api/resolution-budget` stores a typed version-1 limits
document; HMAC secrets and runtime counters are never part of that document.
An absent row is `unconfigured`.

Writes use `expectedRevision` compare-and-set: `null` creates revision 1; a
matching integer increments it; stale writers receive HTTP 409 and must reload
rather than overwrite. SQLite and D1 updates each use a single conditional SQL
statement. The table has one row per Portaless instance and records updater and
timestamp for auditability.

Every PUT requires `AuthService.verifyStepUp`: `password` and `totpCode` when
the account requires it. These factors are request-only and never enter the
configuration or activity payload. Each successful change invokes `emitActivity`
with its actor and revision; rejected authentication, invalid limits and stale
CAS writes do not emit a change event.

The document validates fixed-window duration (1–3600 seconds), attempts
(1–100,000), body allowance (1–64 MiB per scope), bucket capacity (2–4096), and
concurrency (1–64). These are validation bounds, not selected deployment
limits. Configuration contains no secret fields and the endpoint never returns
the HMAC key.

The API currently returns `effective: false` and
`activation: pending_runtime_integration`: persisted settings do not yet
configure the running kernel. Applying them is a later acceptance step after
the owner selects the per-instance vs. shared-counter guarantee and measurements
justify actual limits. No row is seeded and no runtime defaults/B3 behavior
change in this migration.
