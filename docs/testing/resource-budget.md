# Reference resource budget (C39)

Command:

```bash
npm run test:resources
```

Environment: macOS, Node 24, local SQLite. Dataset: 200 pages × 5 published
revisions = **1,000 revisions**.

Measured on 2026-10-21:

| Metric | Value |
|---|---|
| Seed time | 738 ms |
| SQLite canon | 1,810,432 bytes (~1.73 MiB) |
| Backup | 1,810,432 bytes, 10 ms |
| Restore | 8 ms |
| Restored rows | 200 pages / 1,000 revisions |
| Node RSS | 100,777,984 bytes (~96.1 MiB) |
| Budget | 2 GiB RSS / 20 GiB disk |
| Result | **PASS**, no violations |

The check is a reference fixture, not a claim about every dataset or a Cloudum
SLA. A larger dataset should be recorded with the same command and the actual
numbers, and the budget is fail-closed (`exit 1` on a violation).
